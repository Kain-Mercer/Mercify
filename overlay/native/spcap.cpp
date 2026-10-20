// spcap: capture ONLY Spotify's audio (and its child processes) and stream it as raw PCM to
// stdout, for Mercify's "listen on your phone" over WebRTC. Uses WASAPI process loopback
// (Windows 10 2004+). Whole-system capture is Chromium's job; this isolates one app.
//
// Usage:  spcap.exe [--pid <N>] [--exclude]
//   --pid      target process id; if omitted, the first Spotify.exe is found.
//   --exclude  capture everything EXCEPT the target tree (default: only the target tree).
//
// Output (stdout, binary): raw interleaved float32, 48000 Hz, 2 channels. The one status line on
// stderr is JSON: {"ok":1,"pid":1234,"format":"f32le","rate":48000,"ch":2} or {"ok":0,"error":...}.
// Exits when stdout is closed (the parent went away) or on a fatal error.
//
// Build (from Linux, like fgwatch):
//   x86_64-w64-mingw32-g++ -O2 -std=c++17 -municode -static -s -o spcap.exe spcap.cpp \
//       -lole32 -lmmdevapi -lksuser -lavrt
// Build (Windows, MSVC):  cl /O2 /EHsc spcap.cpp ole32.lib mmdevapi.lib

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <initguid.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <tlhelp32.h>
#include <io.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>

// ---- process-loopback definitions (from audioclientactivationparams.h, not in older mingw) ----
#ifndef AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK
typedef enum {
	AUDIOCLIENT_ACTIVATION_TYPE_DEFAULT = 0,
	AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK = 1
} AUDIOCLIENT_ACTIVATION_TYPE;
typedef enum {
	PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE = 0,
	PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE = 1
} PROCESS_LOOPBACK_MODE;
typedef struct {
	DWORD TargetProcessId;
	PROCESS_LOOPBACK_MODE ProcessLoopbackMode;
} AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS;
typedef struct {
	AUDIOCLIENT_ACTIVATION_TYPE ActivationType;
	union {
		AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS ProcessLoopbackParams;
	};
} AUDIOCLIENT_ACTIVATION_PARAMS;
#define VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK L"VAD\\Process_Loopback"
#endif

static const int RATE = 48000, CH = 2;

// IAgileObject is a marker interface (no methods) — reporting it makes the object agile so
// ActivateAudioInterfaceAsync will accept it; without it the call returns E_ILLEGAL_METHOD_CALL.
#ifndef __IAgileObject_INTERFACE_DEFINED__
MIDL_INTERFACE("94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90") IAgileObject : public IUnknown {};
#endif
DEFINE_GUID(IID_IAgileObject_local, 0x94ea2b94, 0xe9cc, 0x49e0, 0xc0, 0xff, 0xee, 0x64, 0xca, 0x8f, 0x5b, 0x90);

// Completion handler for ActivateAudioInterfaceAsync: just signals an event; the result is read
// from the async operation afterwards. Agile (IAgileObject) so the async infra will accept it.
struct ActivateHandler : public IActivateAudioInterfaceCompletionHandler, public IAgileObject {
	HANDLE done;
	LONG ref = 1;
	ActivateHandler() { done = CreateEventW(NULL, FALSE, FALSE, NULL); }
	HRESULT STDMETHODCALLTYPE ActivateCompleted(IActivateAudioInterfaceAsyncOperation *) override {
		SetEvent(done);
		return S_OK;
	}
	HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void **o) override {
		if (IsEqualIID(riid, IID_IUnknown) || IsEqualIID(riid, IID_IActivateAudioInterfaceCompletionHandler)) {
			*o = static_cast<IActivateAudioInterfaceCompletionHandler *>(this);
			InterlockedIncrement(&ref);
			return S_OK;
		}
		if (IsEqualIID(riid, IID_IAgileObject_local)) {
			*o = static_cast<IAgileObject *>(this);
			InterlockedIncrement(&ref);
			return S_OK;
		}
		*o = NULL;
		return E_NOINTERFACE;
	}
	ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&ref); }
	ULONG STDMETHODCALLTYPE Release() override {
		LONG r = InterlockedDecrement(&ref);
		if (!r) delete this;
		return r;
	}
};

static void status(const char *json) { fprintf(stderr, "%s\n", json); fflush(stderr); }
static void statusHr(const char *where, HRESULT hr) {
	char b[256];
	snprintf(b, sizeof(b), "{\"ok\":0,\"error\":\"%s\",\"hr\":\"0x%08lX\"}", where, (unsigned long)hr);
	status(b);
}

struct Proc { DWORD pid, ppid; wchar_t exe[MAX_PATH]; };
static Proc g_procs[2048];
static int g_nproc = 0;
static char g_diag[8192];

static void snapshotProcs() {
	g_nproc = 0;
	HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
	if (snap == INVALID_HANDLE_VALUE) return;
	PROCESSENTRY32W e;
	e.dwSize = sizeof(e);
	if (Process32FirstW(snap, &e)) {
		do {
			if (g_nproc >= 2048) break;
			g_procs[g_nproc].pid = e.th32ProcessID;
			g_procs[g_nproc].ppid = e.th32ParentProcessID;
			wcsncpy(g_procs[g_nproc].exe, e.szExeFile, MAX_PATH - 1);
			g_procs[g_nproc].exe[MAX_PATH - 1] = 0;
			g_nproc++;
		} while (Process32NextW(snap, &e));
	}
	CloseHandle(snap);
}
static const Proc *byPid(DWORD pid) {
	for (int i = 0; i < g_nproc; i++) if (g_procs[i].pid == pid) return &g_procs[i];
	return NULL;
}
static bool isSpotify(const wchar_t *exe) { return _wcsicmp(exe, L"Spotify.exe") == 0; }

// The root Spotify.exe: a Spotify process whose parent isn't itself Spotify (the main window
// process). Falls back to any Spotify.exe. Also fills g_diag with the tree for debugging.
static DWORD findSpotify() {
	snapshotProcs();
	DWORD root = 0, any = 0;
	for (int i = 0; i < g_nproc; i++) {
		if (!isSpotify(g_procs[i].exe)) continue;
		if (!any) any = g_procs[i].pid;
		const Proc *par = byPid(g_procs[i].ppid);
		if (!par || !isSpotify(par->exe)) { root = g_procs[i].pid; break; }
	}
	DWORD target = root ? root : any;

	// Build a diagnostic line: the target, its parent, and its direct non-Spotify children (the
	// likely culprits — e.g. a browser launched from Spotify ends up in its process tree).
	char *p = g_diag;
	const Proc *t = byPid(target);
	const Proc *par = t ? byPid(t->ppid) : NULL;
	p += snprintf(p, 256, "{\"diag\":\"spotify-tree\",\"target\":%lu,\"parent\":\"%ls(%lu)\",\"children\":[",
		(unsigned long)target, par ? par->exe : L"?", (unsigned long)(t ? t->ppid : 0));
	bool first = true;
	for (int i = 0; i < g_nproc && (p - g_diag) < 7000; i++) {
		if (g_procs[i].ppid != target) continue;
		p += snprintf(p, 128, "%s\"%ls(%lu)\"", first ? "" : ",", g_procs[i].exe, (unsigned long)g_procs[i].pid);
		first = false;
	}
	snprintf(p, 64, "]}");
	return target;
}

int wmain(int argc, wchar_t **argv) {
	DWORD pid = 0;
	PROCESS_LOOPBACK_MODE mode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
	for (int i = 1; i < argc; i++) {
		if (!wcscmp(argv[i], L"--pid") && i + 1 < argc) pid = (DWORD)_wtoi(argv[++i]);
		else if (!wcscmp(argv[i], L"--exclude")) mode = PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;
	}
	if (!pid) pid = findSpotify();
	if (!pid) { status("{\"ok\":0,\"error\":\"Spotify isn't running\"}"); return 2; }

	HRESULT hr = CoInitializeEx(NULL, COINIT_MULTITHREADED);
	if (FAILED(hr)) { statusHr("CoInitializeEx", hr); return 3; }

	// Format we ask the virtual loopback device to give us: 48 kHz stereo float32.
	WAVEFORMATEX fmt;
	fmt.wFormatTag = WAVE_FORMAT_IEEE_FLOAT;
	fmt.nChannels = CH;
	fmt.nSamplesPerSec = RATE;
	fmt.wBitsPerSample = 32;
	fmt.nBlockAlign = (fmt.nChannels * fmt.wBitsPerSample) / 8;
	fmt.nAvgBytesPerSec = fmt.nSamplesPerSec * fmt.nBlockAlign;
	fmt.cbSize = 0;

	AUDIOCLIENT_ACTIVATION_PARAMS ap;
	ZeroMemory(&ap, sizeof(ap));
	ap.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
	ap.ProcessLoopbackParams.TargetProcessId = pid;
	ap.ProcessLoopbackParams.ProcessLoopbackMode = mode;

	PROPVARIANT prop;
	PropVariantInit(&prop);
	prop.vt = VT_BLOB;
	prop.blob.cbSize = sizeof(ap);
	prop.blob.pBlobData = (BYTE *)&ap;

	ActivateHandler *handler = new ActivateHandler();
	IActivateAudioInterfaceAsyncOperation *op = NULL;
	hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, IID_IAudioClient, &prop, handler, &op);
	if (FAILED(hr)) { statusHr("ActivateAudioInterfaceAsync", hr); return 4; }
	WaitForSingleObject(handler->done, INFINITE);

	HRESULT activateHr = E_FAIL;
	IUnknown *unk = NULL;
	hr = op->GetActivateResult(&activateHr, &unk);
	if (FAILED(hr) || FAILED(activateHr) || !unk) { statusHr("GetActivateResult", FAILED(hr) ? hr : activateHr); return 5; }

	IAudioClient *client = NULL;
	unk->QueryInterface(IID_IAudioClient, (void **)&client);
	unk->Release();
	if (!client) { status("{\"ok\":0,\"error\":\"no IAudioClient\"}"); return 6; }

	// 200 ms buffer, event-driven. For process loopback the stream flags carry loopback+event and
	// the shared-mode periods must be 0.
	REFERENCE_TIME dur = 2000000; // 200 ms in 100-ns units
	hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK, dur, 0, &fmt, NULL);
	if (FAILED(hr)) { statusHr("Initialize", hr); return 7; }

	HANDLE ev = CreateEventW(NULL, FALSE, FALSE, NULL);
	client->SetEventHandle(ev);

	IAudioCaptureClient *cap = NULL;
	hr = client->GetService(IID_IAudioCaptureClient, (void **)&cap);
	if (FAILED(hr) || !cap) { status("{\"ok\":0,\"error\":\"no capture client\"}"); return 8; }

	// stdout must be binary, or Windows mangles 0x0A bytes.
	_setmode(_fileno(stdout), _O_BINARY);
	FILE *out = stdout;

	hr = client->Start();
	if (FAILED(hr)) { statusHr("Start", hr); return 9; }

	char ready[128];
	snprintf(ready, sizeof(ready), "{\"ok\":1,\"pid\":%lu,\"format\":\"f32le\",\"rate\":%d,\"ch\":%d}", (unsigned long)pid, RATE, CH);
	status(ready);
	if (g_diag[0]) status(g_diag); // the Spotify process tree, for debugging what's in the capture

	const UINT32 frameBytes = fmt.nBlockAlign;
	const UINT32 silenceFrames = RATE / 50; // 20 ms of silence to emit when the app is quiet
	static float silence[silenceFrames * CH];
	for (;;) {
		DWORD w = WaitForSingleObject(ev, 1000);
		UINT32 packet = 0;
		if (FAILED(cap->GetNextPacketSize(&packet))) break;
		bool wrote = false;
		while (packet > 0) {
			BYTE *data = NULL;
			UINT32 frames = 0;
			DWORD flags = 0;
			if (FAILED(cap->GetBuffer(&data, &frames, &flags, NULL, NULL))) { packet = 0; break; }
			if (frames > 0) {
				if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
					for (UINT32 i = 0; i < frames * (UINT32)CH; i++) ((float *)data)[0]; // ignore; write zeros below
					static float zero[480 * CH];
					UINT32 left = frames;
					while (left > 0) {
						UINT32 n = left > 480 ? 480 : left;
						if (fwrite(zero, frameBytes, n, out) != n) { cap->ReleaseBuffer(frames); goto done; }
						left -= n;
					}
				} else if (fwrite(data, frameBytes, frames, out) != frames) {
					cap->ReleaseBuffer(frames);
					goto done;
				}
				wrote = true;
			}
			cap->ReleaseBuffer(frames);
			if (FAILED(cap->GetNextPacketSize(&packet))) { packet = 0; break; }
		}
		if (wrote) fflush(out);
		(void)w;
		(void)silence;
	}
done:
	client->Stop();
	cap->Release();
	client->Release();
	CoUninitialize();
	return 0;
}

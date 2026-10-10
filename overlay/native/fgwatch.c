// fgwatch: tiny helper that reports which window is in front.
//
// Prints one JSON line to stdout whenever the foreground window changes (and a heartbeat
// every 2 s): {"pid":1234,"hwnd":...,"mon":...,"exe":"Wow.exe","title":"World of Warcraft"}
// plus, once told which window is the game ("anchor <hwnd>" on stdin), its state:
// "anchor":{"hwnd":...,"alive":1,"iconic":0,"visible":1,"mon":...}
// Exits on its own when the parent process (the overlay) goes away.
//
// Build (from Linux):  x86_64-w64-mingw32-gcc -O2 -municode -static -s -o fgwatch.exe fgwatch.c
// Build (Windows, MSVC): cl /O2 fgwatch.c user32.lib

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <wchar.h>

static char out[8192];

// Append a UTF-16 string to `dst` as escaped JSON (UTF-8).
static size_t json_str(char *dst, size_t cap, const wchar_t *s) {
	char utf8[3072];
	int n = WideCharToMultiByte(CP_UTF8, 0, s, -1, utf8, sizeof(utf8), NULL, NULL);
	if (n <= 0) utf8[0] = 0;
	size_t o = 0;
	if (o < cap) dst[o++] = '"';
	for (const unsigned char *p = (const unsigned char *)utf8; *p && o + 7 < cap; p++) {
		unsigned char c = *p;
		if (c == '"' || c == '\\') {
			dst[o++] = '\\';
			dst[o++] = (char)c;
		} else if (c < 0x20) {
			o += (size_t)snprintf(dst + o, cap - o, "\\u%04x", c);
		} else {
			dst[o++] = (char)c;
		}
	}
	if (o < cap) dst[o++] = '"';
	return o;
}

static DWORD cached_pid = 0;
static wchar_t cached_exe[MAX_PATH] = L"";

static const wchar_t *exe_for_pid(DWORD pid) {
	if (pid == cached_pid) return cached_exe;
	cached_pid = pid;
	cached_exe[0] = 0;
	HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
	if (h) {
		wchar_t full[MAX_PATH * 2];
		DWORD size = MAX_PATH * 2;
		if (QueryFullProcessImageNameW(h, 0, full, &size)) {
			const wchar_t *base = wcsrchr(full, L'\\');
			wcsncpy(cached_exe, base ? base + 1 : full, MAX_PATH - 1);
			cached_exe[MAX_PATH - 1] = 0;
		}
		CloseHandle(h);
	}
	// Some anti-cheat-protected games refuse OpenProcess: exe stays "" and the overlay matches by title.
	return cached_exe;
}

// ---------------------------------------------------------------- --hide / --show
//
//   fgwatch.exe --hide Spotify.exe 30000
//     Waits up to 30 s for the program's main window (visible, titled, not owned by another
//     window), hides it (like "minimise to tray") and prints {"hidden":[hwnd,...]}.
//   fgwatch.exe --show 1234 5678
//     Shows and restores the given windows again.

typedef struct {
	const wchar_t *exe;
	HWND found[16];
	int count;
} FindCtx;

static BOOL CALLBACK find_main_windows(HWND hwnd, LPARAM lp) {
	FindCtx *ctx = (FindCtx *)lp;
	if (ctx->count >= 16) return FALSE;
	if (!IsWindowVisible(hwnd) || GetWindow(hwnd, GW_OWNER) != NULL) return TRUE;
	if (GetWindowTextLengthW(hwnd) == 0) return TRUE;
	DWORD pid = 0;
	GetWindowThreadProcessId(hwnd, &pid);
	if (!pid) return TRUE;
	cached_pid = 0; // always look the name up fresh here
	if (_wcsicmp(exe_for_pid(pid), ctx->exe) != 0) return TRUE;
	ctx->found[ctx->count++] = hwnd;
	return TRUE;
}

static int hide_windows(const wchar_t *exe, DWORD timeout_ms) {
	FindCtx ctx = { exe, { 0 }, 0 };
	DWORD start = GetTickCount();
	for (;;) {
		ctx.count = 0;
		EnumWindows(find_main_windows, (LPARAM)&ctx);
		if (ctx.count > 0 || GetTickCount() - start >= timeout_ms) break;
		Sleep(250);
	}
	printf("{\"hidden\":[");
	for (int i = 0; i < ctx.count; i++) {
		ShowWindowAsync(ctx.found[i], SW_HIDE);
		printf("%s%llu", i ? "," : "", (unsigned long long)(ULONG_PTR)ctx.found[i]);
	}
	printf("]}\n");
	fflush(stdout);
	return 0;
}

static int show_windows(int argc, wchar_t **argv) {
	for (int i = 2; i < argc; i++) {
		HWND hwnd = (HWND)(ULONG_PTR)_wcstoui64(argv[i], NULL, 10);
		if (!IsWindow(hwnd)) continue;
		ShowWindowAsync(hwnd, SW_SHOW);
		ShowWindowAsync(hwnd, SW_RESTORE);
		SetForegroundWindow(hwnd);
	}
	return 0;
}

int wmain(int argc, wchar_t **argv) {
	if (argc >= 3 && wcscmp(argv[1], L"--hide") == 0) return hide_windows(argv[2], argc >= 4 ? (DWORD)_wtoi(argv[3]) : 0);
	if (argc >= 2 && wcscmp(argv[1], L"--show") == 0) return show_windows(argc, argv);

	HANDLE parent = NULL;
	if (argc > 1) {
		DWORD ppid = (DWORD)_wtoi(argv[1]);
		if (ppid) parent = OpenProcess(SYNCHRONIZE, FALSE, ppid);
	}

	// The overlay can tell us which window is "the game" by writing "anchor <hwnd>\n" to our
	// stdin. We then report whether it still exists, whether it's minimised, and which monitor
	// it's on, so the overlay can stay up while you use another monitor.
	HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
	char inbuf[256];
	size_t inlen = 0;
	HWND anchor = NULL;

	char last_line[8192] = "";
	DWORD last_emit = 0;

	for (;;) {
		if (parent && WaitForSingleObject(parent, 0) == WAIT_OBJECT_0) return 0;

		// read any "anchor <hwnd>" lines without blocking
		DWORD avail = 0;
		if (in && in != INVALID_HANDLE_VALUE && PeekNamedPipe(in, NULL, 0, NULL, &avail, NULL) && avail > 0) {
			DWORD got = 0;
			if (ReadFile(in, inbuf + inlen, (DWORD)(sizeof(inbuf) - 1 - inlen), &got, NULL) && got > 0) {
				inlen += got;
				inbuf[inlen] = 0;
				char *nl;
				while ((nl = strchr(inbuf, '\n')) != NULL) {
					*nl = 0;
					if (strncmp(inbuf, "anchor ", 7) == 0) anchor = (HWND)(ULONG_PTR)_strtoui64(inbuf + 7, NULL, 10);
					size_t rest = inlen - (size_t)(nl + 1 - inbuf);
					memmove(inbuf, nl + 1, rest + 1);
					inlen = rest;
				}
				if (inlen >= sizeof(inbuf) - 1) inlen = 0; // garbage: drop it
			}
		}

		HWND hwnd = GetForegroundWindow();
		DWORD pid = 0;
		wchar_t title[512] = L"";
		if (hwnd) {
			GetWindowThreadProcessId(hwnd, &pid);
			GetWindowTextW(hwnd, title, 512);
		}
		unsigned long long mon = hwnd ? (unsigned long long)(ULONG_PTR)MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) : 0;

		const wchar_t *exe = pid ? exe_for_pid(pid) : L"";
		size_t o = (size_t)snprintf(out, sizeof(out), "{\"pid\":%lu,\"hwnd\":%llu,\"mon\":%llu,\"exe\":", (unsigned long)pid, (unsigned long long)(ULONG_PTR)hwnd, mon);
		o += json_str(out + o, sizeof(out) - o - 200, exe);
		o += (size_t)snprintf(out + o, sizeof(out) - o, ",\"title\":");
		o += json_str(out + o, sizeof(out) - o - 200, title);
		if (anchor) {
			int alive = IsWindow(anchor) ? 1 : 0;
			int iconic = alive && IsIconic(anchor) ? 1 : 0;
			int visible = alive && IsWindowVisible(anchor) ? 1 : 0;
			unsigned long long amon = alive ? (unsigned long long)(ULONG_PTR)MonitorFromWindow(anchor, MONITOR_DEFAULTTONEAREST) : 0;
			o += (size_t)snprintf(out + o, sizeof(out) - o, ",\"anchor\":{\"hwnd\":%llu,\"alive\":%d,\"iconic\":%d,\"visible\":%d,\"mon\":%llu}",
				(unsigned long long)(ULONG_PTR)anchor, alive, iconic, visible, amon);
		}
		o += (size_t)snprintf(out + o, sizeof(out) - o, "}\n");

		DWORD now = GetTickCount();
		if (strcmp(out, last_line) != 0 || now - last_emit > 2000) {
			if (fwrite(out, 1, o, stdout) != o || fflush(stdout) != 0) return 0; // pipe closed: overlay is gone
			strncpy(last_line, out, sizeof(last_line) - 1);
			last_emit = now;
		}
		Sleep(150);
	}
}

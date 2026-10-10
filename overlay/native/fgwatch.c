// fgwatch: tiny helper that reports which window is in front.
//
// Prints one JSON line to stdout whenever the foreground window changes (and a
// heartbeat every 2 s):  {"pid":1234,"exe":"Wow.exe","title":"World of Warcraft"}
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

	HWND last_hwnd = (HWND)-1;
	DWORD last_pid = 0;
	wchar_t last_title[512] = L"";
	DWORD last_emit = 0;

	for (;;) {
		if (parent && WaitForSingleObject(parent, 0) == WAIT_OBJECT_0) return 0;

		HWND hwnd = GetForegroundWindow();
		DWORD pid = 0;
		wchar_t title[512] = L"";
		if (hwnd) {
			GetWindowThreadProcessId(hwnd, &pid);
			GetWindowTextW(hwnd, title, 512);
		}

		DWORD now = GetTickCount();
		if (hwnd != last_hwnd || pid != last_pid || wcscmp(title, last_title) != 0 || now - last_emit > 2000) {
			const wchar_t *exe = pid ? exe_for_pid(pid) : L"";
			size_t o = (size_t)snprintf(out, sizeof(out), "{\"pid\":%lu,\"exe\":", (unsigned long)pid);
			o += json_str(out + o, sizeof(out) - o - 16, exe);
			o += (size_t)snprintf(out + o, sizeof(out) - o, ",\"title\":");
			o += json_str(out + o, sizeof(out) - o - 4, title);
			o += (size_t)snprintf(out + o, sizeof(out) - o, "}\n");
			if (fwrite(out, 1, o, stdout) != o || fflush(stdout) != 0) return 0; // pipe closed: overlay is gone
			last_hwnd = hwnd;
			last_pid = pid;
			wcscpy(last_title, title);
			last_emit = now;
		}
		Sleep(150);
	}
}

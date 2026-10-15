// fgwatch: tiny helper that reports which window is in front.
//
// Prints one JSON line to stdout whenever the foreground window changes (and a heartbeat
// every 2 s): {"pid":1234,"hwnd":...,"mon":...,"exe":"Wow.exe","title":"World of Warcraft"}
// (plus "cls", the window class), and once told which window is the game ("anchor <hwnd>" on stdin), its state:
// "anchor":{"hwnd":...,"alive":1,"iconic":0,"visible":1,"mon":...}
// "activate <hwnd>" on stdin brings that window back to the front and reports {"activate","ok","via"}.
// "zone <x> <y> <w> <h> [<x> <y> <w> <h> ...]" on stdin (physical screen pixels, up to 16
// rectangles) sets the click zone; see below. "zone off" ends it.
// Exits on its own when the parent process (the overlay) goes away.
//
// Build (from Linux):  x86_64-w64-mingw32-gcc -O2 -municode -static -s -o fgwatch.exe fgwatch.c
// Build (Windows, MSVC): cl /O2 fgwatch.c user32.lib

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <wchar.h>

static char out[8192];

// stdout is written by the main loop and by the click-zone writer thread.
static CRITICAL_SECTION out_lock;

static int write_line(const char *line, size_t n) {
	EnterCriticalSection(&out_lock);
	int ok = fwrite(line, 1, n, stdout) == n && fflush(stdout) == 0;
	LeaveCriticalSection(&out_lock);
	return ok;
}

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

// Make `h` the foreground window again (handing the keyboard back to the game after a click on
// the overlay) and print how it went: {"activate":<hwnd>,"ok":1,"via":"set"}.
// Windows only lets certain processes change the foreground window, so try, in order:
// plain SetForegroundWindow (allowed because Mercify, which started us, is in front), the same
// while attached to the foreground thread's input, after a synthetic Alt tap (which lifts the
// foreground lock), and SwitchToThisWindow.
static int is_front(HWND h) {
	return GetForegroundWindow() == h;
}

static void activate(HWND h) {
	const char *via = "none";
	int ok = 0;
	if (!h || !IsWindow(h)) via = "gone";
	else if (IsIconic(h) || !IsWindowVisible(h)) via = "minimised"; // never restore a minimised game
	else if (is_front(h)) ok = 1, via = "already";
	else {
		if (SetForegroundWindow(h) && (Sleep(30), is_front(h))) ok = 1, via = "set";
		if (!ok) {
			HWND fg = GetForegroundWindow();
			DWORD fg_thread = fg ? GetWindowThreadProcessId(fg, NULL) : 0;
			DWORD me = GetCurrentThreadId();
			if (fg_thread && fg_thread != me && AttachThreadInput(me, fg_thread, TRUE)) {
				SetForegroundWindow(h);
				AttachThreadInput(me, fg_thread, FALSE);
				Sleep(30);
				if (is_front(h)) ok = 1, via = "attach";
			}
		}
		if (!ok) {
			INPUT in[2];
			ZeroMemory(in, sizeof(in));
			in[0].type = INPUT_KEYBOARD;
			in[0].ki.wVk = VK_MENU;
			in[1] = in[0];
			in[1].ki.dwFlags = KEYEVENTF_KEYUP;
			SendInput(2, in, sizeof(INPUT));
			SetForegroundWindow(h);
			Sleep(30);
			if (is_front(h)) ok = 1, via = "alt";
		}
		if (!ok) {
			SwitchToThisWindow(h, TRUE);
			Sleep(50);
			if (is_front(h)) ok = 1, via = "switch";
		}
	}
	char line[160];
	int n = snprintf(line, sizeof(line), "{\"activate\":%llu,\"ok\":%d,\"via\":\"%s\"}\n", (unsigned long long)(ULONG_PTR)h, ok, via);
	write_line(line, (size_t)n);
}

// ---------------------------------------------------------------- click zone
//
// Mercify's panels take clicks without the overlay window being activated: the game drops every
// held key when it loses the keyboard (you'd stop running mid-WASD). So the window stays
// click-through and this helper watches the mouse instead, with a low-level mouse hook on its own thread (never Mercify's busy main thread):
// a left press inside the zone is kept from the game and reported, with the drag and release
// that follow, as {"zone":"down"|"move"|"up","x":..,"y":..} (physical screen pixels); a wheel
// notch there as {"zone":"wheel","x":..,"y":..,"d":120}. Right clicks in the zone are kept from
// the game too, and reported on release as {"zone":"context",...} (Mercify's right-click menus). While the cursor is hidden (the game is steering the camera) or another button
// is held, everything passes through untouched. The hook only exists while a zone is set.

static CRITICAL_SECTION zone_lock;
#define MAX_ZONES 16
static RECT zones[MAX_ZONES];
static int nzones;           // 0: no zone
static int capturing;        // left button went down in the zone; its drag and release are ours
static int right_eaten;      // right button went down in the zone; its release is ours too
static DWORD last_move;
static DWORD hook_thread_id;
static HANDLE hook_ready;

#define ZQ 64
static char zq[ZQ][80];
static int zq_head, zq_tail;
static HANDLE zq_event;

static void zone_report(const char *kind, POINT pt, int d) {
	EnterCriticalSection(&zone_lock);
	int next = (zq_tail + 1) % ZQ;
	if (next != zq_head) { // full: drop (only ever a burst of moves)
		snprintf(zq[zq_tail], sizeof(zq[0]), "{\"zone\":\"%s\",\"x\":%ld,\"y\":%ld,\"d\":%d}\n", kind, pt.x, pt.y, d);
		zq_tail = next;
	}
	LeaveCriticalSection(&zone_lock);
	SetEvent(zq_event);
}

static DWORD WINAPI zone_writer(LPVOID unused) {
	(void)unused;
	char line[80];
	for (;;) {
		WaitForSingleObject(zq_event, INFINITE);
		for (;;) {
			EnterCriticalSection(&zone_lock);
			int have = zq_head != zq_tail;
			if (have) {
				memcpy(line, zq[zq_head], sizeof(line));
				zq_head = (zq_head + 1) % ZQ;
			}
			LeaveCriticalSection(&zone_lock);
			if (!have) break;
			write_line(line, strlen(line));
		}
	}
	return 0;
}

static int cursor_showing(void) {
	CURSORINFO ci = { sizeof(ci) };
	return GetCursorInfo(&ci) && (ci.flags & CURSOR_SHOWING);
}

static LRESULT CALLBACK mouse_hook(int code, WPARAM wp, LPARAM lp) {
	if (code != HC_ACTION) return CallNextHookEx(NULL, code, wp, lp);
	const MSLLHOOKSTRUCT *m = (const MSLLHOOKSTRUCT *)lp;
	POINT pt = m->pt;
	int eat = 0;
	EnterCriticalSection(&zone_lock);
	int inside = 0;
	for (int i = 0; i < nzones && !inside; i++) inside = PtInRect(&zones[i], pt);
	LeaveCriticalSection(&zone_lock);
	switch (wp) {
	case WM_LBUTTONDOWN:
		if (inside && !right_eaten && !(GetAsyncKeyState(VK_RBUTTON) & 0x8000) && cursor_showing()) {
			capturing = 1;
			eat = 1;
			last_move = GetTickCount();
			zone_report("down", pt, 0);
		}
		break;
	case WM_MOUSEMOVE: // never kept from the game: the cursor has to move
		if (capturing && GetTickCount() - last_move >= 15) {
			last_move = GetTickCount();
			zone_report("move", pt, 0);
		}
		break;
	case WM_LBUTTONUP:
		if (capturing) {
			capturing = 0;
			eat = 1;
			zone_report("up", pt, 0);
		}
		break;
	case WM_RBUTTONDOWN:
		if (inside && !capturing && !(GetAsyncKeyState(VK_LBUTTON) & 0x8000) && cursor_showing()) right_eaten = eat = 1;
		break;
	case WM_RBUTTONUP:
		if (right_eaten) {
			right_eaten = 0;
			eat = 1;
			zone_report("context", pt, 0);
		}
		break;
	case WM_MOUSEWHEEL:
		if (inside && !capturing && cursor_showing()) {
			eat = 1;
			zone_report("wheel", pt, (int)(short)HIWORD(m->mouseData));
		}
		break;
	}
	return eat ? 1 : CallNextHookEx(NULL, code, wp, lp);
}

#define ZONE_ON (WM_APP + 1)
#define ZONE_OFF (WM_APP + 2)

static DWORD WINAPI hook_thread(LPVOID unused) {
	(void)unused;
	MSG msg;
	HHOOK hook = NULL;
	PeekMessageW(&msg, NULL, WM_USER, WM_USER, PM_NOREMOVE); // create the queue before anyone posts to it
	SetEvent(hook_ready);
	while (GetMessageW(&msg, NULL, 0, 0) > 0) {
		if (msg.message == ZONE_ON && !hook) hook = SetWindowsHookExW(WH_MOUSE_LL, mouse_hook, GetModuleHandleW(NULL), 0);
		else if (msg.message == ZONE_OFF && hook) {
			UnhookWindowsHookEx(hook);
			hook = NULL;
			if (capturing) {
				// the release will go to the game; tell the overlay the drag is over
				POINT pt;
				GetCursorPos(&pt);
				zone_report("cancel", pt, 0);
			}
			capturing = right_eaten = 0;
		}
	}
	return 0;
}

static void set_zone(const char *args) {
	RECT r[MAX_ZONES];
	int n = 0, used = 0;
	long x, y, w, h;
	while (n < MAX_ZONES && sscanf(args, " %ld %ld %ld %ld%n", &x, &y, &w, &h, &used) == 4) {
		args += used;
		if (w > 0 && h > 0) SetRect(&r[n++], (int)x, (int)y, (int)(x + w), (int)(y + h));
	}
	EnterCriticalSection(&zone_lock);
	memcpy(zones, r, sizeof(RECT) * (size_t)n);
	nzones = n;
	LeaveCriticalSection(&zone_lock);
	if (!hook_thread_id) {
		if (!n) return;
		hook_ready = CreateEventW(NULL, TRUE, FALSE, NULL);
		zq_event = CreateEventW(NULL, FALSE, FALSE, NULL);
		CreateThread(NULL, 0, zone_writer, NULL, 0, NULL);
		HANDLE t = CreateThread(NULL, 0, hook_thread, NULL, 0, &hook_thread_id);
		if (t) SetThreadPriority(t, THREAD_PRIORITY_TIME_CRITICAL); // the whole desktop's mouse waits on it
		WaitForSingleObject(hook_ready, 2000);
	}
	PostThreadMessageW(hook_thread_id, n ? ZONE_ON : ZONE_OFF, 0, 0);
}

int wmain(int argc, wchar_t **argv) {
	if (argc >= 3 && wcscmp(argv[1], L"--hide") == 0) return hide_windows(argv[2], argc >= 4 ? (DWORD)_wtoi(argv[3]) : 0);
	if (argc >= 2 && wcscmp(argv[1], L"--show") == 0) return show_windows(argc, argv);

	InitializeCriticalSection(&out_lock);
	InitializeCriticalSection(&zone_lock);

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
					else if (strncmp(inbuf, "activate ", 9) == 0) activate((HWND)(ULONG_PTR)_strtoui64(inbuf + 9, NULL, 10));
					else if (strncmp(inbuf, "zone ", 5) == 0) set_zone(inbuf + 5);
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
		wchar_t cls[128] = L"";
		if (hwnd) {
			GetWindowThreadProcessId(hwnd, &pid);
			GetWindowTextW(hwnd, title, 512);
			GetClassNameW(hwnd, cls, 128);
		}
		unsigned long long mon = hwnd ? (unsigned long long)(ULONG_PTR)MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) : 0;

		const wchar_t *exe = pid ? exe_for_pid(pid) : L"";
		size_t o = (size_t)snprintf(out, sizeof(out), "{\"pid\":%lu,\"hwnd\":%llu,\"mon\":%llu,\"exe\":", (unsigned long)pid, (unsigned long long)(ULONG_PTR)hwnd, mon);
		o += json_str(out + o, sizeof(out) - o - 200, exe);
		o += (size_t)snprintf(out + o, sizeof(out) - o, ",\"title\":");
		o += json_str(out + o, sizeof(out) - o - 200, title);
		o += (size_t)snprintf(out + o, sizeof(out) - o, ",\"cls\":");
		o += json_str(out + o, sizeof(out) - o - 200, cls);
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
			if (!write_line(out, o)) return 0; // pipe closed: overlay is gone
			strncpy(last_line, out, sizeof(last_line) - 1);
			last_emit = now;
		}
		Sleep(150);
	}
}

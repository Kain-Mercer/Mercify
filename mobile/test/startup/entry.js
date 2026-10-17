import "../../src/polyfills";
import * as M from "../../src/mercify";
const t0 = Date.now();
M.init().then(
	() => { const st = M.getLobby().state(); console.log("INIT OK in", Date.now() - t0, "ms; lobby", st.status, "fid", M.getFriends().fid); setTimeout(() => process.exit(0), 300); },
	(e) => { console.log("INIT FAILED:", e && e.stack || e); process.exit(1); }
);

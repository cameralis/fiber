import { writeFileSync } from "node:fs";
import { join } from "node:path";

// The approvals page: published as a private claude.ai artifact, opened in the
// Claude app. Buttons call the viewer's "fiber" connector directly via
// window.claude.mcp — no LLM in the approval path. The PIN lives only in the
// input field; it is never stored.

export function approvalsPageHtml(): string {
  return `<title>fiber approvals</title>
<style>
  :root {
    --bg: #f7f7f9; --surface: #ffffff; --ink: #1d1f27; --muted: #6b6e7e;
    --line: #e3e4ea; --accent: #5560d4; --good: #2e7d52; --good-ink: #ffffff;
    --bad: #b4453f; --bad-soft: #f7e9e8; --code-bg: #f1f1f5;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #15161c; --surface: #1e2028; --ink: #e9eaf0; --muted: #9195a6;
      --line: #2e3040; --accent: #8b96f0; --good: #4eba7f; --good-ink: #10231a;
      --bad: #e0736c; --bad-soft: #322022; --code-bg: #181a21;
    }
  }
  :root[data-theme="dark"] {
    --bg: #15161c; --surface: #1e2028; --ink: #e9eaf0; --muted: #9195a6;
    --line: #2e3040; --accent: #8b96f0; --good: #4eba7f; --good-ink: #10231a;
    --bad: #e0736c; --bad-soft: #322022; --code-bg: #181a21;
  }
  :root[data-theme="light"] {
    --bg: #f7f7f9; --surface: #ffffff; --ink: #1d1f27; --muted: #6b6e7e;
    --line: #e3e4ea; --accent: #5560d4; --good: #2e7d52; --good-ink: #ffffff;
    --bad: #b4453f; --bad-soft: #f7e9e8; --code-bg: #f1f1f5;
  }
  html { background: var(--bg); }
  body {
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    color: var(--ink); background: var(--bg); margin: 0; padding: 16px;
  }
  main { max-width: 560px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  h1 { font-size: 1.05rem; margin: 0; letter-spacing: 0.01em; }
  h1 .thread { color: var(--accent); }
  .who { color: var(--muted); font-size: 0.85rem; }
  .pin-row {
    display: flex; gap: 10px; align-items: center; background: var(--surface);
    border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px;
    position: sticky; top: 8px; z-index: 2;
  }
  .pin-row label { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
  .pin-row input {
    flex: 1; min-width: 0; font: inherit; letter-spacing: 0.3em; color: var(--ink);
    background: var(--code-bg); border: 1px solid var(--line); border-radius: 7px; padding: 8px 10px;
  }
  .pin-row input:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .banner {
    border: 1px solid var(--line); border-left: 3px solid var(--accent); background: var(--surface);
    border-radius: 8px; padding: 10px 12px; font-size: 0.9rem;
  }
  .banner.error { border-left-color: var(--bad); }
  .card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
  .card .meta { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .from { font-weight: 600; font-size: 0.92rem; }
  .from::before { content: "from "; font-weight: 400; color: var(--muted); }
  time { color: var(--muted); font-size: 0.8rem; font-variant-numeric: tabular-nums; }
  .body {
    font: 0.85rem/1.55 ui-monospace, "SF Mono", Menlo, monospace;
    background: var(--code-bg); border: 1px solid var(--line); border-radius: 8px;
    padding: 10px 12px; white-space: pre-wrap; overflow-wrap: anywhere; overflow-x: auto; margin: 0;
  }
  .actions { display: flex; gap: 10px; }
  button {
    font: 600 0.92rem/1 inherit; font-family: inherit; border-radius: 9px; border: 1px solid var(--line);
    padding: 11px 0; flex: 1; cursor: pointer; background: var(--surface); color: var(--ink);
    transition: filter 120ms ease;
  }
  button:hover { filter: brightness(1.05); }
  button:disabled { opacity: 0.55; cursor: default; }
  button.approve { background: var(--good); border-color: var(--good); color: var(--good-ink); }
  button.decline { background: transparent; border-color: var(--bad); color: var(--bad); }
  .card .note { font-size: 0.84rem; color: var(--bad); background: var(--bad-soft); border-radius: 7px; padding: 7px 10px; }
  .card .note.ok { color: var(--good); background: transparent; padding: 0; }
  .empty { color: var(--muted); text-align: center; padding: 28px 0 12px; font-size: 0.92rem; }
  section h2 { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); margin: 10px 0 8px; }
  ul.recent { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  ul.recent li { display: flex; justify-content: space-between; gap: 8px; font-size: 0.85rem; color: var(--muted); }
  .pill { border: 1px solid var(--line); border-radius: 99px; padding: 1px 9px; font-size: 0.75rem; }
  .pill.approved, .pill.done, .pill.running { color: var(--good); border-color: var(--good); }
  .pill.declined { color: var(--bad); border-color: var(--bad); }
  .updated { color: var(--muted); font-size: 0.78rem; text-align: center; font-variant-numeric: tabular-nums; }
  @media (prefers-reduced-motion: reduce) { button { transition: none; } }
</style>
<main>
  <header>
    <h1><span class="thread">fiber</span> approvals</h1>
    <span class="who" id="who"></span>
  </header>
  <div class="pin-row">
    <label for="pin">PIN</label>
    <input id="pin" type="password" inputmode="numeric" autocomplete="off" placeholder="approval PIN" />
  </div>
  <div id="status"></div>
  <section>
    <div id="pending"></div>
  </section>
  <section id="recent-wrap" hidden>
    <h2>Recently resolved</h2>
    <ul class="recent" id="recent"></ul>
  </section>
  <p class="updated" id="updated"></p>
</main>
<script>
(function () {
  var SERVER = "fiber";
  var statusEl = document.getElementById("status");
  var pendingEl = document.getElementById("pending");
  var recentEl = document.getElementById("recent");
  var recentWrap = document.getElementById("recent-wrap");
  var whoEl = document.getElementById("who");
  var updatedEl = document.getElementById("updated");
  var pinEl = document.getElementById("pin");
  var busy = {};

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function banner(msg, isError) {
    statusEl.innerHTML = msg ? '<div class="banner' + (isError ? " error" : "") + '">' + msg + "</div>" : "";
  }
  function errCopy(err) {
    var code = err && err.code;
    if (code === "server_not_connected") return 'The <strong>fiber</strong> connector is not set up for your account. Add it in claude.ai Settings \\u2192 Connectors (name it exactly \\u201cfiber\\u201d, URL from <code>fiber setup</code>).';
    if (code === "needs_reauth") return 'Reconnect the <strong>fiber</strong> connector in claude.ai Settings \\u2192 Connectors.';
    if (code === "selection_required") return 'More than one \\u201cfiber\\u201d connector exists \\u2014 choose one when claude.ai asks, or remove the duplicate.';
    if (code === "not_granted" || code === "capability_disabled" || code === "capability_removed") return "This page needs connector access \\u2014 reopen it inside claude.ai or the Claude app.";
    if (code === "tool_error") {
      var t = err.result && err.result.content && err.result.content[0] && err.result.content[0].text;
      return esc(t || err.message);
    }
    return esc(err && err.message ? err.message : "Connector unavailable right now.");
  }
  function fmtTime(ms) {
    var d = new Date(ms);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function render(data, cacheInfo) {
    whoEl.textContent = data.user ? "for " + data.user : "";
    if (!data.pending.length) {
      pendingEl.innerHTML = '<div class="empty">Nothing awaiting your approval.</div>';
    } else {
      pendingEl.innerHTML = data.pending.map(function (m) {
        return (
          '<div class="card" data-id="' + esc(m.id) + '">' +
          '<div class="meta"><span class="from">' + esc(m.from) + "</span><time>" + fmtTime(m.createdAt) + "</time></div>" +
          '<pre class="body">' + esc(m.body) + "</pre>" +
          '<div class="actions">' +
          '<button class="decline" data-act="decline">Decline</button>' +
          '<button class="approve" data-act="approve">Approve</button>' +
          "</div><div class="+'"'+"slot"+'"'+"></div></div>"
        );
      }).join("");
    }
    if (data.recent.length) {
      recentWrap.hidden = false;
      recentEl.innerHTML = data.recent.map(function (m) {
        return "<li><span>from " + esc(m.from) + '</span><span class="pill ' + esc(m.status) + '">' + esc(m.status) + "</span></li>";
      }).join("");
    } else {
      recentWrap.hidden = true;
    }
    updatedEl.textContent = cacheInfo && cacheInfo.storedAt ? "updated " + fmtTime(cacheInfo.storedAt) : "";
  }

  function payloadOf(result) {
    if (result.structuredContent) return result.structuredContent;
    if (result.payload) return result.payload;
    try { return JSON.parse(result.content[0].text); } catch (e) { return null; }
  }

  function act(card, action) {
    var id = card.getAttribute("data-id");
    var pin = pinEl.value.trim();
    var slot = card.querySelector(".slot");
    if (!pin) {
      slot.innerHTML = '<div class="note">Enter your approval PIN above first.</div>';
      pinEl.focus();
      return;
    }
    if (busy[id]) return;
    busy[id] = true;
    card.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
    window.claude.mcp.callTool(SERVER, action, { id: id, pin: pin }, { cache: false })
      .then(function (res) {
        var p = payloadOf(res);
        slot.innerHTML = '<div class="note ok">' + esc((p && p.message) || (typeof p === "string" ? p : "Done")) + "</div>";
        return window.claude.mcp.invalidate(SERVER, "list_pending");
      })
      .catch(function (err) {
        slot.innerHTML = '<div class="note">' + errCopy(err) + "</div>";
      })
      .then(function () {
        busy[id] = false;
        card.querySelectorAll("button").forEach(function (b) { b.disabled = false; });
      });
  }

  pendingEl.addEventListener("click", function (ev) {
    var btn = ev.target.closest("button[data-act]");
    if (!btn) return;
    act(btn.closest(".card"), btn.getAttribute("data-act"));
  });

  if (!window.claude || window.claude.mcp === undefined) {
    banner("This page must be opened inside claude.ai or the Claude app (it uses your fiber connector).", true);
    return;
  }

  var unsubscribe = window.claude.mcp.watchTool(SERVER, "list_pending", null, function (ev) {
    if (ev.type === "data") {
      var p = payloadOf(ev.result);
      if (p === null || typeof p === "string") {
        banner(esc(typeof p === "string" ? p : "Unexpected response from the fiber connector."), true);
        return;
      }
      banner("");
      render(p, ev.result.cache);
    } else {
      var code = ev.error && ev.error.code;
      var retract = code === "needs_reauth" || code === "server_not_connected" || code === "blocked_by_policy" || code === "approval_required";
      if (retract) { pendingEl.innerHTML = ""; recentWrap.hidden = true; }
      banner(errCopy(ev.error), true);
    }
  }, { refetchInterval: 30000 });
  void unsubscribe;
})();
</script>
`;
}

export async function approvalsPage(): Promise<void> {
  const path = join(process.cwd(), "fiber-approvals.html");
  writeFileSync(path, approvalsPageHtml());
  console.log(`fiber: wrote ${path}`);
  console.log("Publish it as a PRIVATE claude.ai artifact with the mcp capability, e.g. tell Claude:");
  console.log('  "Publish fiber-approvals.html as an artifact with capabilities');
  console.log('   {mcp: {servers: [{server: \\"fiber\\", tools: [\\"list_pending\\", \\"approve\\", \\"decline\\"]}]}}"');
  console.log("Then open it in the Claude app — that page is where you approve incoming fiber messages.");
}

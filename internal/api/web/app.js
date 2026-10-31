/* SplitTrust console: a view over the same JSON the CLI prints. It never computes verdicts. */
"use strict";

const DEVICES = ["validating-stub", "private-dns", "hybrid"];
const $ = (sel) => document.querySelector(sel);

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* Colour rules (design section 10). */
function verdictClass(decision, reason, grant) {
  if (decision === "rejected") return "rejected";
  if (decision === "indeterminate") return "indeterminate";
  if (decision === "accepted") {
    if (reason === "EXTERNAL_TOKEN_MATCH" && !(grant && grant.external_ad)) return "caution";
    if (grant && grant.local_dnssec_mode === "not_established") return "caution";
    return "accepted";
  }
  return "indeterminate";
}

function runClass(run) {
  if (run.decision !== "accepted") return run.decision;
  return run.claims.some((c) => verdictClass(c.decision, c.reason, c.grant) === "caution") ? "caution" : "accepted";
}

let scenarios = [];

async function loadScenarios() {
  scenarios = await api("/api/scenarios");
  const tbody = $("#scenario-table tbody");
  tbody.innerHTML = "";
  for (const s of scenarios) {
    const tr = document.createElement("tr");
    tr.dataset.id = s.id;
    const opts = DEVICES.map((d) => `<option value="${d}" ${d === s.default_device ? "selected" : ""}>${d}</option>`).join("");
    const real = s.requires_internet;
    tr.innerHTML = `
      <td><div class="title">${esc(s.title)}${real ? ' <span class="chip caution">real DNS</span>' : ""}</div><div class="id">${esc(s.id)} · example: <code>${esc(s.example_qname)}</code></div><div class="explain">${esc(s.explanation)}</div></td>
      <td><select class="device">${opts}</select></td>
      <td class="expected"></td>
      <td class="actual"><span class="muted">${real ? "this console has no Internet access — run it from the terminal (see explanation)" : "—"}</span></td>
      <td>${real ? "" : `<button class="verify">Verify</button> <button class="secondary resolve">Resolve example</button>`}</td>`;
    tbody.appendChild(tr);
    const sel = tr.querySelector(".device");
    const renderExpected = () => {
      const e = (s.expected || []).find((x) => x.device === sel.value);
      tr.querySelector(".expected").innerHTML = e
        ? `<span class="chip expected">${esc(e.decision)}</span><span class="reason">${esc(e.reason)}</span>`
        : `<span class="muted">not part of the demo for this device</span>`;
    };
    sel.addEventListener("change", renderExpected);
    renderExpected();
    if (!real) {
      tr.querySelector(".verify").addEventListener("click", () => runVerify(s, tr));
      tr.querySelector(".resolve").addEventListener("click", () => runResolve(s, tr));
    }
  }
}

function select(tr) {
  document.querySelectorAll("#scenario-table tr").forEach((r) => r.classList.remove("selected"));
  tr.classList.add("selected");
}

async function runVerify(s, tr) {
  select(tr);
  const btn = tr.querySelector(".verify");
  const device = tr.querySelector(".device").value;
  btn.disabled = true;
  tr.querySelector(".actual").innerHTML = `<span class="muted">verifying…</span>`;
  $("#trace-hint").textContent = `Verifying ${s.id} as ${device}…`;
  $("#trace-body").innerHTML = "";
  try {
    const run = await api("/api/verify", { scenario_id: s.id, device, resolution: $("#resolution").value });
    const cls = runClass(run);
    const reasons = run.claims.map((c) => c.reason).join(" · ");
    tr.querySelector(".actual").innerHTML = `<span class="chip ${cls}">${esc(run.decision)}</span><span class="reason">${esc(reasons)}</span>`;
    renderRun(s, run);
  } catch (err) {
    tr.querySelector(".actual").innerHTML = `<span class="chip indeterminate">error</span><span class="reason">${esc(err.message)}</span>`;
    $("#trace-hint").textContent = `Error: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

function renderRun(s, run) {
  $("#trace-hint").innerHTML = `<b>${esc(s.title)}</b> — device <code>${esc(run.device)}</code>, resolution <code>${esc(run.resolution)}</code>, trust context <code>${esc(run.trust_context)}</code>`;
  const body = $("#trace-body");
  body.innerHTML = "";
  for (const c of run.claims) {
    const cls = verdictClass(c.decision, c.reason, c.grant);
    const div = document.createElement("div");
    div.className = "claim";
    const scopes = c.inspection ? c.inspection.scopes.join(", ") : "";
    let html = `<h3>Claim ${c.index + 1}: <code>${esc(c.resolver)}</code> ${scopes ? `for <code>${esc(scopes)}</code>` : ""}</h3>`;
    for (const st of c.stages) {
      const ev = st.evidence ? `<details><summary>evidence</summary><pre>${esc(JSON.stringify(st.evidence, null, 2))}</pre></details>` : "";
      html += `<div class="stage"><span class="status ${esc(st.status)}">${esc(st.status)}</span><span class="code">${esc(st.id)}<br><small>${esc(st.code || "")}</small></span><span>${esc(st.message || "")}${ev}</span></div>`;
    }
    html += `<div class="verdict"><span class="chip ${cls}">${esc(c.decision)}</span> ${esc(c.reason)}</div>`;
    if (c.grant) {
      const g = c.grant;
      html += `<div class="grant">${esc(g.resolver)} may answer for <b>${esc(g.scopes.join(", "))}</b> until ${esc(g.expires_at)} — path <b>${esc(g.path)}</b>${g.path === "external" ? ` (external resolver AD=${g.external_ad})` : ""}, local DNSSEC <b>${esc(g.local_dnssec_mode)}</b>.`;
      if (cls === "caution") html += ` <span class="warnings">Yellow: this authority rests on ${g.path === "external" ? "the external resolver's honesty — the zone is not DNSSEC-signed" : "a token-only record — no key was delegated, so local answers cannot be validated"}.</span>`;
      html += `</div>`;
    }
    div.innerHTML = html;
    body.appendChild(div);
  }
}

async function runResolve(s, tr) {
  select(tr);
  const device = tr.querySelector(".device").value;
  const btn = tr.querySelector(".resolve");
  btn.disabled = true;
  try {
    const rep = await api("/api/resolve", { scenario_id: s.id, qname: s.example_qname, device, resolution: $("#resolution").value });
    if (rep.verification) renderRun(s, rep.verification);
    else { $("#trace-hint").textContent = `${s.title} — ${rep.qname} is outside the claimed names; no verification needed.`; $("#trace-body").innerHTML = ""; }
    const box = document.createElement("div");
    box.className = "resolve-box";
    const ok = !rep.error_code;
    box.innerHTML = `<div><b>Resolve</b> <code>${esc(rep.qname)}</code> as <code>${esc(rep.device)}</code> → route <b>${esc(rep.route)}</b> <span class="muted">(${esc(rep.route_reason)})</span></div>
      <div class="muted">via ${esc(rep.via || "—")}${rep.security ? ` · ${esc(rep.security)}` : ""}</div>
      ${ok ? `<div class="answers">${esc(rep.answers.join(", ") || "no records")}</div>` : `<div class="verdict"><span class="chip rejected">no answer</span> ${esc(rep.error_code)}: ${esc(rep.error)}</div>`}`;
    $("#trace-body").prepend(box);
  } catch (err) {
    $("#trace-hint").textContent = `Error: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

$("#owner-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const req = {
    resolver: f.get("resolver"), parent: f.get("parent"),
    subdomains: String(f.get("subdomains")).split(",").map((x) => x.trim()).filter(Boolean),
    algorithm: f.get("algorithm"), salt: f.get("salt") || "",
    ds: String(f.get("ds") || "").split(/\s+/).map((x) => x.trim()).filter(Boolean),
  };
  try {
    const b = await api("/api/records/build", req);
    const out = $("#owner-out");
    out.hidden = false;
    if (b.error) {
      $("#owner-zone").textContent = `${b.error}: ${b.detail}`;
      $("#owner-claim").textContent = "";
      $("#owner-warnings").innerHTML = "";
      return;
    }
    $("#owner-zone").textContent = b.zone_line;
    $("#owner-claim").textContent = JSON.stringify(b.claim, null, 2);
    $("#owner-warnings").innerHTML = (b.warnings || []).map((w) => `<li>${esc(w)}</li>`).join("");
  } catch (err) {
    alert(err.message);
  }
});

document.querySelectorAll("button[data-copy]").forEach((b) => b.addEventListener("click", () => {
  navigator.clipboard.writeText($("#" + b.dataset.copy).textContent).then(() => { b.textContent = "copied"; setTimeout(() => (b.textContent = "copy"), 1200); });
}));

/* Client-on-the-network panel: drives the lab DNS proxy through /api/client/*. */
async function refreshClient() {
  try {
    const st = await api("/api/client/status");
    $("#client-net").textContent = `${st.title || st.scenario_id} · ${st.device} · ${st.queries} queries`;
    $("#client-net").className = "";
    const sel = $("#client-scenario");
    if (sel.options.length === 0) {
      for (const s of scenarios.filter((x) => !x.requires_internet)) {
        const o = document.createElement("option"); o.value = s.id; o.textContent = `${s.id} — ${s.title}`; sel.appendChild(o);
      }
    }
    sel.value = st.scenario_id;
    $("#client-device").value = st.device;
    $("#client-grants").innerHTML = st.grants.length
      ? st.grants.map((g) => `<div><span class="chip ${g.decision === "accepted" ? (g.local_dnssec_mode === "delegated" ? "accepted" : "caution") : "rejected"}">${esc(g.decision)}</span> ${esc(g.resolver)} for <code>${esc((g.scopes || []).join(", "))}</code> — ${esc(g.reason)}${g.expires_at ? ` · until ${esc(g.expires_at)}` : ""}</div>`).join("")
      : `<div>No verdicts cached yet — the proxy verifies the network's claims on the first query it receives.</div>`;
  } catch (err) {
    $("#client-net").textContent = `no DNS proxy (${err.message})`;
  }
}
$("#client-join").addEventListener("click", async () => {
  try {
    await api("/api/client/join", { scenario_id: $("#client-scenario").value, device: $("#client-device").value });
    await refreshClient();
  } catch (err) { alert(err.message); }
});

api("/api/capabilities").then((c) => { $("#caps").textContent = `validator: ${c.validator} · devices: ${(c.devices || []).join(", ")}`; }).catch(() => {});
loadScenarios().then(refreshClient).catch((err) => { $("#trace-hint").textContent = `Cannot load scenarios: ${err.message}`; });
setInterval(refreshClient, 5000);

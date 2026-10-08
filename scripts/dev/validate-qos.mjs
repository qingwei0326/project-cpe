// Faithful port of backend/src/dbus/qos.rs parse_qos_response + select_data_bearer
// to validate the QCI-selection logic independently of the Rust cross-build.
function num(s) { const v = parseInt((s || '').trim(), 10); return Number.isFinite(v) ? v : 0 }

function parseQosResponse(response) {
  const bearers = [];
  for (const raw of response.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('+CGEQOSRDP:')) continue;
    const data = line.slice('+CGEQOSRDP:'.length);
    const parts = data.trim().split(',');
    if (parts.length < 2) continue;
    const cid = num(parts[0]);
    const qci = num(parts[1]);
    const dlGbr = num(parts[2]), ulGbr = num(parts[3]);
    const dlMbr = num(parts[4]), ulMbr = num(parts[5]);
    const dlAmbr = num(parts[6]), ulAmbr = num(parts[7]);
    const dlSpeed = dlGbr > 0 ? dlGbr : (dlMbr > 0 ? dlMbr : dlAmbr);
    const ulSpeed = ulGbr > 0 ? ulGbr : (ulMbr > 0 ? ulMbr : ulAmbr);
    bearers.push({ cid, qci, dlSpeed, ulSpeed });
  }
  if (bearers.length === 0) return { qci: 0, dlSpeed: 0, ulSpeed: 0, raw: response };
  const chosen = selectDataBearer(bearers);
  const raw = (chosen.qci >= 1 && chosen.qci <= 86) ? null : response.trim();
  return { qci: chosen.qci, dlSpeed: chosen.dlSpeed, ulSpeed: chosen.ulSpeed, raw };
}

function classOf(qci) {
  if (qci >= 6 && qci <= 9) return 3;
  if (qci >= 1 && qci <= 86) return 2;
  if (qci === 5) return 1;
  return 0;
}
function selectDataBearer(bearers) {
  let best = bearers[0];
  for (const b of bearers) {
    const ca = classOf(b.qci), cb = classOf(best.qci);
    if (ca !== cb) { if (ca > cb) best = b; continue; }
    const ra = b.dlSpeed + b.ulSpeed, rb = best.dlSpeed + best.ulSpeed;
    if (ra !== rb) { if (ra > rb) best = b; continue; }
    if (b.cid > best.cid) best = b;
  }
  return best;
}

const cases = [
  { name: 'multi: control QCI100 first, internet QCI6', resp: "OK\n+CGEQOSRDP: 1,100,0,0,0,0,0,0\n+CGEQOSRDP: 2,6,0,0,0,0,30000,30000", expect: 6 },
  { name: 'single bearer QCI9', resp: "+CGEQOSRDP: 11,9,0,0,0,0,100000,50000", expect: 9 },
  { name: 'IMS QCI5 vs internet QCI9', resp: "+CGEQOSRDP: 1,5,0,0,0,0,1000,1000\n+CGEQOSRDP: 2,9,0,0,0,0,30000,30000", expect: 9 },
  { name: 'invalid only -> 200 + raw', resp: "+CGEQOSRDP: 1,200,0,0,0,0,0,0", expect: 200 },
  { name: 'default PDP QCI0 first + internet QCI6', resp: "+CGEQOSRDP: 0,0,0,0,0,0,0,0\n+CGEQOSRDP: 1,6,0,0,0,0,30000,30000", expect: 6 },
];
let ok = true;
for (const c of cases) {
  const r = parseQosResponse(c.resp);
  const pass = r.qci === c.expect;
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${c.name} -> qci=${r.qci} dl=${r.dlSpeed} raw=${r.raw ? 'set' : 'none'}`);
}
console.log(ok ? '\nALL PASS' : '\nSOME FAILED');
process.exit(ok ? 0 : 1);

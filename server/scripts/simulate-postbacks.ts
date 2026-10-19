import crypto from 'crypto';

const API = process.env.API_URL || 'http://localhost:5000';
const USER_ID = Number(process.env.TEST_USER_ID || 2);

let pass = 0;
let fail = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    pass += 1;
    console.log(`PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL  ${name}`, detail ?? '');
  }
}

async function get(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${API}${path}`);
  return { status: res.status, body: await res.json() };
}

async function balance(): Promise<number> {
  const login = (await (
    await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ashish', password: 'password123' }),
    })
  ).json()) as { token: string };
  const res = await fetch(`${API}/api/auth/me`, {
    headers: { Authorization: `Bearer ${login.token}` },
  });
  const data = (await res.json()) as { user: { balance_cents: number } };
  return data.user.balance_cents;
}

function md5(input: string): string {
  return crypto.createHash('md5').update(input).digest('hex');
}

function hmac(algo: 'sha1' | 'sha256', key: string, input: string): string {
  return crypto.createHmac(algo, key).update(input).digest('hex');
}

async function main(): Promise<void> {
  const start = await balance();
  console.log(`balance before: ${start}\n`);

  // AdGate: valid credit
  let r = await get(
    `/api/postback/adgate?user_id=${USER_ID}&conversion_id=ADG-T1&point_value=150&state=approved&secret=secret_adgate`
  );
  check('adgate credit', r.status === 200 && r.body.status === 'credited', r);

  // AdGate: duplicate
  r = await get(
    `/api/postback/adgate?user_id=${USER_ID}&conversion_id=ADG-T1&point_value=150&state=approved&secret=secret_adgate`
  );
  check('adgate duplicate ignored', r.body.status === 'duplicate', r);

  // AdGate: bad secret
  r = await get(
    `/api/postback/adgate?user_id=${USER_ID}&conversion_id=ADG-T2&point_value=150&state=approved&secret=wrong`
  );
  check('adgate bad secret rejected', r.status === 403, r);

  // CPX: valid credit
  const cpxTx = `CPX-T-${Date.now()}`;
  r = await get(
    `/api/postback/cpx?user_id=${USER_ID}&trans_id=${cpxTx}&amount_local=200&status=1&hash=${md5(
      cpxTx + 'secret_cpx'
    )}`
  );
  check('cpx credit', r.body.status === 'credited', r);

  // CPX: bad hash
  r = await get(
    `/api/postback/cpx?user_id=${USER_ID}&trans_id=CPX-BAD&amount_local=200&status=1&hash=deadbeef`
  );
  check('cpx bad hash rejected', r.status === 403, r);

  // CPX: reversal
  r = await get(
    `/api/postback/cpx?user_id=${USER_ID}&trans_id=${cpxTx}&amount_local=200&status=2&hash=${md5(
      cpxTx + 'secret_cpx'
    )}`
  );
  check('cpx reversal', r.body.status === 'reversed', r);

  // CPX: duplicate reversal
  r = await get(
    `/api/postback/cpx?user_id=${USER_ID}&trans_id=${cpxTx}&amount_local=200&status=2&hash=${md5(
      cpxTx + 'secret_cpx'
    )}`
  );
  check('cpx duplicate reversal ignored', r.body.status === 'duplicate', r);

  // BitLabs: valid credit (hash covers the request target exactly as received)
  const blBase = `/api/postback/bitlabs?uid=${USER_ID}&val=300&tx=BL-T1`;
  r = await get(`${blBase}&hash=${hmac('sha1', 'secret_bitlabs', blBase)}`);
  check('bitlabs credit', r.body.status === 'credited', r);

  // BitLabs: tampered URL
  r = await get(`/api/postback/bitlabs?uid=${USER_ID}&val=9999&tx=BL-T2&hash=${hmac('sha1', 'secret_bitlabs', blBase)}`);
  check('bitlabs tampered url rejected', r.status === 403, r);

  // BitLabs: reversal via reconciliation
  const blRevBase = `/api/postback/bitlabs?uid=${USER_ID}&val=300&tx=BL-T1&type=RECONCILIATION`;
  r = await get(`${blRevBase}&hash=${hmac('sha1', 'secret_bitlabs', blRevBase)}`);
  check('bitlabs reversal', r.body.status === 'reversed', r);

  // Generic: valid credit
  const sig = hmac('sha256', 'secret_offertoro', `${USER_ID}:OT-T1:120:credit`);
  r = await get(`/api/postback/offertoro?user=${USER_ID}&tx=OT-T1&amount=120&action=credit&sig=${sig}`);
  check('generic credit', r.body.status === 'credited', r);

  // Generic: bad sig
  r = await get(`/api/postback/offertoro?user=${USER_ID}&tx=OT-T2&amount=999&action=credit&sig=bad`);
  check('generic bad sig rejected', r.status === 403, r);

  // Unknown user
  const sig2 = hmac('sha256', 'secret_offertoro', `99999:OT-T3:50:credit`);
  r = await get(`/api/postback/offertoro?user=99999&tx=OT-T3&amount=50&action=credit&sig=${sig2}`);
  check('unknown user handled', r.body.status === 'unknown_user', r);

  const end = await balance();
  const expected = start + 150 + 300 - 300 + 120;
  console.log(`\nbalance after: ${end} (expected ${expected})`);
  check('balance math', end === expected, { start, end, expected });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

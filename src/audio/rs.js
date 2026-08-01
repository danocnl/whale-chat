/**
 * Reed-Solomon codec over GF(2^8).
 * Primitive polynomial: x^8 + x^4 + x^3 + x^2 + 1 = 0x11D
 *
 * Polynomial convention throughout:
 *   Standard (MSB-first): p[0]*x^{n-1} + p[1]*x^{n-2} + ... + p[n-1]
 *   Array position i corresponds to degree (n-1-i).
 *
 * encode(data, nsym) → Uint8Array (data.length + nsym bytes)
 * decode(received, nsym) → { data: Uint8Array, errors: number }
 *   Throws 'RS: uncorrectable' if error count > floor(nsym/2).
 *
 * With nsym=8: corrects up to 4 byte errors in any positions —
 * burst errors from room echoes are fully handled by a single codeword.
 */

// ── GF(2^8) tables ────────────────────────────────────────────
const PRIM = 0x11d;
const EXP  = new Uint8Array(512); // doubled so LOG[a]+LOG[b] avoids % 255
const LOG  = new Uint8Array(256);

;(function buildTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x = x * 2;
    if (x >= 256) x ^= PRIM;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const gfMul = (a, b) => (a && b) ? EXP[LOG[a] + LOG[b]] : 0;
const gfInv = (a)    => EXP[255 - LOG[a]];
const gfDiv = (a, b) => {
  if (!b) throw new Error('RS: divide by zero');
  return a ? EXP[(LOG[a] - LOG[b] + 255) % 255] : 0;
};

// Standard polynomial evaluation: p[0]*x^{n-1} + ... + p[n-1]  (left-to-right Horner)
function pEval(p, x) {
  let y = 0;
  for (const c of p) y = gfMul(y, x) ^ c;
  return y;
}

// LSB-first polynomial evaluation: p[0] + p[1]*x + ... + p[n-1]*x^{n-1}  (right-to-left Horner)
// Used only for evaluating the BM error locator σ.
function pEvalLSB(p, x) {
  let y = 0;
  for (let i = p.length - 1; i >= 0; i--) y = gfMul(y, x) ^ p[i];
  return y;
}

// Standard polynomial multiply: (a ○ b)[i] = Σ a[j]*b[i-j]
function pMul(a, b) {
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++)
      out[i + j] ^= gfMul(a[i], b[j]);
  return out;
}

// Generator in standard form: g(x) = ∏(x + α^i), stored [1, g1, g2, ..., g_nsym]
function makeGenerator(nsym) {
  let g = [1];
  for (let i = 0; i < nsym; i++) g = pMul(g, [1, EXP[i]]); // (x + α^i)
  return g;
}

// ── Encode ────────────────────────────────────────────────────
/**
 * Systematic RS encode. Returns data.length + nsym bytes.
 * Layout: [data[0..k-1] | parity[0..nsym-1]]
 */
export function rsEncode(data, nsym) {
  const gen  = makeGenerator(nsym); // gen[0]=1 (leading)
  const work = [...data, ...new Array(nsym).fill(0)];
  for (let i = 0; i < data.length; i++) {
    if (!work[i]) continue;
    for (let j = 1; j <= nsym; j++) work[i + j] ^= gfMul(gen[j], work[i]);
  }
  const out = new Uint8Array(data.length + nsym);
  out.set(data);
  for (let i = 0; i < nsym; i++) out[data.length + i] = work[data.length + i];
  return out;
}

// ── Decode ────────────────────────────────────────────────────

// Berlekamp-Massey. Produces σ in LSB-first: σ[0]=1, σ[i]=coefficient of x^i.
// σ_lsb(X_j^{-1}) = 0 for each error locator element X_j.
function berlekampMassey(synd) {
  let C = [1]; // error locator (LSB-first)
  let B = [1]; // previous C
  let L = 0;   // current number of errors
  let m = 1;   // shift steps since B was last updated
  let b = 1;   // discrepancy when B was last updated

  for (let n = 0; n < synd.length; n++) {
    // Discrepancy d = s_n + Σ_{i=1}^{L} C[i] * s_{n-i}
    let d = synd[n];
    for (let i = 1; i <= L; i++) {
      if (n - i >= 0) d ^= gfMul(C[i], synd[n - i]);
    }

    if (!d) { m++; continue; }

    // T = save current C before update
    const T   = [...C];
    const scl = gfDiv(d, b);
    // Correction = (d/b) * x^m * B
    const corr = [...new Array(m).fill(0), ...B.map(v => gfMul(v, scl))];
    // C = C XOR corr (pad to same length)
    const len  = Math.max(C.length, corr.length);
    const newC = new Array(len).fill(0);
    for (let i = 0; i < C.length; i++)  newC[i] ^= C[i];
    for (let i = 0; i < corr.length; i++) newC[i] ^= corr[i];

    if (2 * L <= n) {
      // Update auxiliary polynomial and error count
      B = T; L = n + 1 - L; b = d; m = 1;
    } else {
      m++;
    }
    C = newC;
  }
  return C;
}

// Gaussian elimination over GF(256): solve the Vandermonde-like system
// s_i = Σ_k e_k * X_{pos[k]}^i  for i = 0..e-1
// where X_p = α^{n-1-p} (standard convention, position p → degree n-1-p)
function gfSolve(positions, synd, n) {
  const e = positions.length;
  // A[i][k] = X_{pos[k]}^i = α^{i*(n-1-pos[k])}
  const mat = Array.from({ length: e }, (_, i) =>
    [...Array.from({ length: e }, (_, k) => {
      const exp = (i * (n - 1 - positions[k])) % 255;
      return exp < 0 ? EXP[exp + 255] : EXP[exp];
    }), synd[i]]
  );
  for (let col = 0; col < e; col++) {
    let pivot = -1;
    for (let row = col; row < e; row++) {
      if (mat[row][col]) { pivot = row; break; }
    }
    if (pivot < 0) throw new Error('RS: singular system');
    if (pivot !== col) [mat[col], mat[pivot]] = [mat[pivot], mat[col]];
    const inv = gfInv(mat[col][col]);
    mat[col] = mat[col].map(v => gfMul(v, inv));
    for (let row = 0; row < e; row++) {
      if (row === col || !mat[row][col]) continue;
      const f = mat[row][col];
      for (let j = 0; j <= e; j++) mat[row][j] ^= gfMul(f, mat[col][j]);
    }
  }
  return mat.map(row => row[e]);
}

/**
 * RS decode. Corrects up to floor(nsym/2) errors.
 * @param {Uint8Array} received  k + nsym bytes
 * @param {number}     nsym
 * @returns {{ data: Uint8Array, errors: number }}
 */
export function rsDecode(received, nsym) {
  const msg = new Uint8Array(received);
  const n   = msg.length;

  // 1. Syndromes: s_i = received(α^i) using standard polynomial evaluation
  const synd = Array.from({ length: nsym }, (_, i) => pEval([...msg], EXP[i]));
  if (synd.every(s => !s)) {
    return { data: msg.slice(0, n - nsym), errors: 0 };
  }

  // 2. Error locator polynomial σ via Berlekamp-Massey (LSB-first output)
  const sigma = berlekampMassey(synd);
  const nErr  = sigma.length - 1;
  if (!nErr) return { data: msg.slice(0, n - nsym), errors: 0 };
  if (2 * nErr > nsym) throw new Error('RS: uncorrectable');

  // 3. Chien search: position p (0-indexed) has X_p = α^{n-1-p}
  //    Find p where σ_lsb(X_p^{-1}) = 0
  const positions = [];
  for (let p = 0; p < n; p++) {
    const xInv = gfInv(EXP[(n - 1 - p) % 255]);
    if (pEvalLSB(sigma, xInv) === 0) positions.push(p);
  }
  if (positions.length !== nErr) throw new Error(`RS: located ${positions.length}/${nErr}`);

  // 4. Vandermonde solve for error magnitudes
  const magnitudes = gfSolve(positions, synd, n);

  // 5. Correct errors
  for (let i = 0; i < positions.length; i++) msg[positions[i]] ^= magnitudes[i];

  return { data: msg.slice(0, n - nsym), errors: positions.length };
}

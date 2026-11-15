'use strict';
// Taking the battle back to an earlier moment, for looking ahead (lookahead.cjs). snapshot() records, for every
// object, array, Set and Map reachable from the root, a shallow copy of what it holds; restore() writes those copies
// back into the same objects. Nothing is replaced, so every reference the code holds (a unit in another unit's
// lockedWith, a hook closing over the state) stays good. Functions are kept as they are, and typed arrays (the path
// fields' costs) are treated as values, since nothing edits them after they're made. Objects the battle creates after
// the snapshot simply fall out of reach on restore.
// What it can't see: state held in closures. The dice keep theirs that way, so a look ahead swaps in its own dice;
// the battle log is a closure too, so it swaps state.log for a silent one.

/** A record of everything reachable from root (skipping the objects in `skip`). */
function snapshot(root, skip = new Set()) {
  const seen = new Map();
  const stack = [root];
  const push = (v) => { if (v !== null && typeof v === 'object' && !ArrayBuffer.isView(v) && !skip.has(v) && !seen.has(v)) stack.push(v); };
  while (stack.length) {
    const o = stack.pop();
    if (seen.has(o)) continue;
    let saved;
    if (Array.isArray(o)) { saved = o.slice(); for (const v of saved) push(v); }
    else if (o instanceof Set) { saved = [...o]; for (const v of saved) push(v); }
    else if (o instanceof Map) { saved = [...o]; for (const [k, v] of saved) { push(k); push(v); } }
    else {
      saved = {};
      for (const k of Object.keys(o)) {
        const d = Object.getOwnPropertyDescriptor(o, k);
        if (d.get || d.set) continue;
        saved[k] = d.value;
        push(d.value);
      }
    }
    seen.set(o, saved);
  }
  return seen;
}

/** Put everything back as it was when the snapshot was taken. */
function restore(seen) {
  for (const [o, saved] of seen) {
    if (Array.isArray(o)) { o.length = saved.length; for (let i = 0; i < saved.length; i++) o[i] = saved[i]; }
    else if (o instanceof Set) { o.clear(); for (const v of saved) o.add(v); }
    else if (o instanceof Map) { o.clear(); for (const [k, v] of saved) o.set(k, v); }
    else {
      for (const k of Object.keys(o)) {
        if (k in saved) continue;
        const d = Object.getOwnPropertyDescriptor(o, k);
        if (!d.get && !d.set) delete o[k];
      }
      Object.assign(o, saved);
    }
  }
}

module.exports = { snapshot, restore };

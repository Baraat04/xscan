/** A risk score as a ring: the arc covers the score's share of the circle. */
export function Ring({ value, size = 80 }: { value: number; size?: number }) {
  const c = 2 * Math.PI * 34;
  return (
    <svg className="dial" width={size} height={size} viewBox="0 0 80 80" aria-hidden>
      <circle cx="40" cy="40" r="34" className="dial-track" />
      <circle cx="40" cy="40" r="34" className="dial-fill" strokeDasharray={`${c * Math.max(0, Math.min(1, value))} ${c}`} transform="rotate(-90 40 40)" />
    </svg>
  );
}

/** Opposing forces with their numbers: prosecution pulls from the left, defense from the right. */
export function Tug({ pros, def }: { pros: number; def: number }) {
  const total = Math.max(0.01, pros + def);
  const at = (pros / total) * 100;
  return (
    <div className="tug" role="img" aria-label={`Prosecution strength ${pros.toFixed(2)}, defense strength ${def.toFixed(2)}`}>
      <span className="tug-n p">{pros.toFixed(2)}</span>
      <span className="tug-track">
        <i className="tug-p" style={{ width: `${at}%` }} />
        <i className="tug-d" style={{ width: `${100 - at}%` }} />
        <b className="tug-knot" style={{ left: `${at}%` }} />
      </span>
      <span className="tug-n d">{def.toFixed(2)}</span>
    </div>
  );
}

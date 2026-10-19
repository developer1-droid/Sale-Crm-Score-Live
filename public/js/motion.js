/* One switch for every animation: the OS "reduce motion" setting or animation.enabled = false. */
const query = window.matchMedia('(prefers-reduced-motion: reduce)');
let enabled = true;
let speed = 1;

export const motionOff = () => query.matches || !enabled;
export const motionSpeed = () => speed;

/** Also exposes the state to CSS: data-motion="off" and --anim-k (duration multiplier). */
export function setMotion(animation) {
  enabled = animation.enabled !== false;
  speed = animation.speed || 1;
  const root = document.documentElement;
  root.dataset.motion = motionOff() ? 'off' : 'on';
  root.style.setProperty('--anim-k', String(1 / speed));
}
query.addEventListener('change', () => { document.documentElement.dataset.motion = motionOff() ? 'off' : 'on'; });

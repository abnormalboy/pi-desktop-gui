/** The original probe: one bubble timestamp, target MutationObserver, and one rAF. */
export function armSessionSwitchMeasurement(marker) {
  window.switchMeasurement = new Promise((resolve, reject) => {
    let started;
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error('Target messages did not appear'));
    }, 10000);
    const observer = new MutationObserver(() => {
      if (started === undefined || !document.querySelector('.thread')?.textContent.includes(marker)) return;
      observer.disconnect();
      clearTimeout(timeout);
      requestAnimationFrame(() => resolve(performance.now() - started));
    });
    document.addEventListener(
      'click',
      () => {
        started = performance.now();
      },
      { once: true },
    );
    observer.observe(document.querySelector('.thread'), {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
}

/** Opt-in observation only; rAF completion never depends on invoke settlement. */
export function armRecordedSessionSwitchMeasurement({ marker, targetId, index }) {
  const recorder = window.__sessionSwitchRecorder;
  recorder.arm(targetId, index);
  window.switchMeasurement = new Promise((resolve, reject) => {
    let started;
    const timeout = setTimeout(() => {
      observer.disconnect();
      recorder.mark('target.timeout');
      reject(new Error('Target messages did not appear'));
    }, 10000);
    const observer = new MutationObserver(() => {
      if (started === undefined || !document.querySelector('.thread')?.textContent.includes(marker)) return;
      observer.disconnect();
      clearTimeout(timeout);
      recorder.mark('target.mo');
      requestAnimationFrame(() => {
        const now = performance.now();
        recorder.mark('target.raf', { elapsedMs: now - started }, now);
        resolve(now - started);
      });
    });
    document.addEventListener(
      'click',
      () => {
        started = performance.now();
        recorder.mark('click.bubble', {}, started);
      },
      { once: true },
    );
    observer.observe(document.querySelector('.thread'), {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
}

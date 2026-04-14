/**
 * Set up MIDI access and bind input handlers.
 *
 * @param {object} options
 * @param {Function} options.onNoteOn - Called with (note, velocity) on MIDI note on
 * @param {Function} options.onNoteOff - Called with (note) on MIDI note off
 * @param {Function} options.onStatusChange - Called with status string
 * @returns {Promise<MIDIAccess|null>} The MIDI access object, or null if unavailable
 */
export async function setupMidi({ onNoteOn, onNoteOff, onStatusChange }) {
  if (!navigator.requestMIDIAccess) {
    onStatusChange?.("Web MIDI not supported");
    return null;
  }

  try {
    const access = await navigator.requestMIDIAccess();

    const bind = () => {
      const inputs = Array.from(access.inputs.values());
      if (!inputs.length) {
        onStatusChange?.("No MIDI connected");
        return;
      }
      onStatusChange?.(`${inputs.length} MIDI input${inputs.length > 1 ? "s" : ""} ready`);

      inputs.forEach((inp) => {
        inp.onmidimessage = (msg) => {
          const [st, d1, d2] = msg.data;
          const cmd = st & 0xf0;
          if (cmd === 0x90 && d2 > 0) {
            onNoteOn?.(d1, d2 / 127);
          } else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) {
            onNoteOff?.(d1);
          }
        };
      });
    };

    bind();
    access.onstatechange = bind;
    return access;
  } catch {
    onStatusChange?.("MIDI access denied");
    return null;
  }
}

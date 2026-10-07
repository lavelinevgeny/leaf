import { PassThrough, Writable } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { readPassword } from '../src/server/admin.js';

afterEach(() => vi.unstubAllEnvs());

function terminal() {
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    isRaw: false,
    setRawMode(mode: boolean) {
      this.isRaw = mode;
      return this;
    },
  });
  let displayed = '';
  const output = Object.assign(
    new Writable({
      write(chunk, _encoding, callback) {
        displayed += String(chunk);
        callback();
      },
    }),
    { isTTY: true },
  );
  return {
    input,
    output,
    displayed: () => displayed,
    read: () =>
      readPassword(
        'Synthetic prompt: ',
        input as unknown as NodeJS.ReadStream,
        output as unknown as NodeJS.WriteStream,
      ),
  };
}

it.each([
  ['plain Unicode', 'Synthetic-пароль-123!\r', 'Synthetic-пароль-123!'],
  ['backspace', 'Synthetic-demo-123!X\x7f\r', 'Synthetic-demo-123!'],
  [
    'cursor editing',
    'Synthetic-demo-13!\x1b[D\x1b[D2\r',
    'Synthetic-demo-123!',
  ],
  [
    'split cursor sequence',
    ['Synthetic-demo-13!', '\x1b[', 'D', '\x1b[D', '2\r'],
    'Synthetic-demo-123!',
  ],
  [
    'bracketed paste',
    '\x1b[200~Synthetic-demo-123!\x1b[201~\r',
    'Synthetic-demo-123!',
  ],
])(
  'reads %s without echo or control bytes in the password',
  async (_name, chunks, expected) => {
    const tty = terminal();
    const reading = tty.read();
    for (const chunk of typeof chunks === 'string' ? [chunks] : chunks)
      tty.input.write(chunk);
    await expect(reading).resolves.toBe(expected);
    expect(tty.displayed()).toBe('Synthetic prompt: \n');
    expect(tty.input.isRaw).toBe(false);
    expect(tty.input.listenerCount('keypress')).toBe(0);
    tty.input.destroy();
    tty.output.destroy();
  },
);

it('reads two consecutive hidden prompts on the same terminal', async () => {
  const tty = terminal();
  const first = tty.read();
  tty.input.write('Synthetic-first-123!\r');
  await expect(first).resolves.toBe('Synthetic-first-123!');
  const second = tty.read();
  tty.input.write('Synthetic-second-123!\r');
  await expect(second).resolves.toBe('Synthetic-second-123!');
  expect(tty.displayed()).toBe('Synthetic prompt: \nSynthetic prompt: \n');
  tty.input.destroy();
  tty.output.destroy();
});

it.each(['dumb', 'xterm', undefined])(
  'keeps hidden terminal editing independent of TERM=%s',
  async (terminalType) => {
    vi.stubEnv('TERM', terminalType);
    const tty = terminal();
    try {
      const reading = tty.read();
      tty.input.write('Synthetic-demo-13!X\x7f\x1b[D\x1b[D2\r');
      await expect(reading).resolves.toBe('Synthetic-demo-123!');
      expect(tty.displayed()).toBe('Synthetic prompt: \n');
      expect(tty.input.isRaw).toBe(false);
      expect(process.env.TERM).toBe(terminalType);
    } finally {
      tty.input.destroy();
      tty.output.destroy();
    }
  },
);

it.each(['\x03', '\x04'])(
  'cancels on a terminal interrupt or EOF',
  async (input) => {
    const tty = terminal();
    const reading = tty.read();
    tty.input.write(input);
    await expect(reading).rejects.toThrow('cancelled');
    expect(tty.input.isRaw).toBe(false);
    expect(tty.displayed()).toBe('Synthetic prompt: \n');
    tty.input.destroy();
    tty.output.destroy();
  },
);

it('rejects excessive input without echoing it', async () => {
  const tty = terminal();
  const reading = tty.read();
  tty.input.write('x'.repeat(1025));
  await expect(reading).rejects.toThrow('too long');
  expect(tty.input.isRaw).toBe(false);
  expect(tty.displayed()).toBe('Synthetic prompt: \n');
  tty.input.destroy();
  tty.output.destroy();
});

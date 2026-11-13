import {
  checkDestinations,
  classifyAddress,
  classifyHost,
  isCloudModel,
} from './destinations';

const dns = (table: Record<string, string[]>) => async (name: string) => {
  if (!table[name]) throw new Error('ENOTFOUND');
  return table[name];
};

describe('destinations of document content', () => {
  it.each([
    ['127.0.0.1', 'local'],
    ['::1', 'local'],
    ['10.0.0.5', 'private'],
    ['172.20.1.2', 'private'],
    ['192.168.0.20', 'private'],
    ['100.101.2.3', 'private'],
    ['fd12::1', 'private'],
    ['8.8.8.8', 'public'],
    ['172.32.0.1', 'public'],
    ['2606:4700::1111', 'public'],
  ])('classifies the address %s as %s', (ip, location) => {
    expect(classifyAddress(ip)).toBe(location);
  });

  it('classifies names', async () => {
    const resolve = dns({
      'gpu.empresa.com.br': ['10.1.1.9'],
      'api.example.com': ['93.184.216.34'],
      'mixed.example.com': ['10.0.0.1', '1.2.3.4'],
    });
    expect(await classifyHost('localhost', resolve)).toBe('local');
    expect(await classifyHost('host.docker.internal', resolve)).toBe('local');
    expect(await classifyHost('ollama', resolve)).toBe('local'); // a container of this installation
    expect(await classifyHost('servidor.local', resolve)).toBe('private');
    expect(await classifyHost('gpu.empresa.com.br', resolve)).toBe('private');
    expect(await classifyHost('api.example.com', resolve)).toBe('public');
    expect(await classifyHost('mixed.example.com', resolve)).toBe('public');
    expect(await classifyHost('nowhere.example', resolve)).toBe('public'); // unresolvable: assume the worst
  });

  it('recognises Ollama cloud models', () => {
    expect(isCloudModel('gpt-oss:120b-cloud')).toBe(true);
    expect(isCloudModel('qwen3-coder:480b-cloud')).toBe(true);
    expect(isCloudModel('qwen3:8b')).toBe(false);
    expect(isCloudModel('cloudy-model:7b')).toBe(false);
  });

  it('starts normally with everything on this machine', async () => {
    const warn = jest.fn();
    const d = await checkDestinations(
      {
        OLLAMA_URL: 'http://localhost:11434',
        DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      },
      warn,
      dns({}),
    );
    expect(d.llm.location).toBe('local');
    expect(d.database.location).toBe('local');
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns when the LLM is another machine of the private network', async () => {
    const warn = jest.fn();
    await checkDestinations(
      {
        OLLAMA_URL: 'http://192.168.0.50:11434',
        DATABASE_URL: 'postgresql://u:p@db:5432/db',
      },
      warn,
      dns({}),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('192.168.0.50:11434'),
    );
  });

  it('refuses to start with the LLM or the database on the internet, unless allowed on purpose', async () => {
    const resolve = dns({
      'llm.example.com': ['93.184.216.34'],
      'db.example.com': ['93.184.216.35'],
    });
    await expect(
      checkDestinations(
        {
          OLLAMA_URL: 'https://llm.example.com',
          DATABASE_URL: 'postgresql://u:p@db:5432/x',
        },
        jest.fn(),
        resolve,
      ),
    ).rejects.toThrow(/ALLOW_REMOTE_LLM/);
    await expect(
      checkDestinations(
        {
          OLLAMA_URL: 'http://localhost:11434',
          DATABASE_URL: 'postgresql://u:p@db.example.com:5432/x',
        },
        jest.fn(),
        resolve,
      ),
    ).rejects.toThrow(/ALLOW_REMOTE_DATABASE/);
    await expect(
      checkDestinations(
        {
          OLLAMA_URL: 'http://localhost:11434',
          LLM_MODEL: 'gpt-oss:120b-cloud',
        },
        jest.fn(),
        resolve,
      ),
    ).rejects.toThrow(/cloud model/);
    const warn = jest.fn();
    await checkDestinations(
      { OLLAMA_URL: 'https://llm.example.com', ALLOW_REMOTE_LLM: '1' },
      warn,
      resolve,
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('llm.example.com'),
    );
  });
});

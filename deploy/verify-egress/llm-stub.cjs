// Stands in for Ollama inside the isolated network during ./verify-egress.sh:
// answers like a well-behaved model (cited, numbers from the document).
'use strict';
require('http')
  .createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen3:8b' }] }));
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const last = JSON.parse(body || '{}').messages?.at(-1)?.content ?? '';
      const content = /Explique|Explain/.test(last)
        ? 'Contrato de prestação de serviços de limpeza. O valor mensal é de R$ 12.500,00 [p. 2].'
        : 'O valor mensal é de R$ 12.500,00 [p. 2].';
      res.end(JSON.stringify({ message: { role: 'assistant', content } }));
    });
  })
  .listen(11434, () => console.log('LLM stand-in listening on 11434'));

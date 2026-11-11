/**
 * Small local models (gemma:2b, qwen2:0.5b) often open with filler such as
 * "Sure, here's the explanation of the document in 3 paragraphs:" even when
 * the prompt forbids it. This removes such an opening, and nothing else.
 *
 * A first line is only treated as filler when it is short and either
 *  - is an acknowledgement ("Sure!", "Certainly.", "Okay,"), or
 *  - announces the answer and ends with ':' ("Here's the summary:",
 *    "Below is an explanation of the document:", "**Explanation:**").
 * A first line that carries content ("Here is an invoice from ACME for $42.")
 * is kept.
 */
const ACK = /^(?:sure|certainly|of course|absolutely|okay|ok|alright|great)\s*[,!.:]+\s*/i;
const ANNOUNCEMENT =
  /^(?:here(?:'s| is| are)|below is|the following is|this is)\b[^\n]{0,160}:\s*/i;
const LABEL = /^(?:\*\*|#+\s*)?(?:explanation|summary|answer|resumo|explicação|resposta)\s*:?\s*(?:\*\*)?\s*:?\s*(?:\n|$)/i;

export function stripPreamble(text: string): string {
  let result = text.trim();
  for (let i = 0; i < 3; i++) {
    const before = result;
    result = result.replace(ACK, '');
    result = result.replace(ANNOUNCEMENT, '');
    result = result.replace(LABEL, '');
    result = result.replace(/^\*\*\s*\*\*/, '').trim();
    if (result === before) break;
  }
  if (!result) return text.trim();
  return result.charAt(0).toUpperCase() + result.slice(1);
}

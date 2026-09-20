/** Conservative JSON recovery for model answers. Never evaluates code or invents missing closing syntax. */
// These TeX commands start with a *valid* JSON escape (\b/\f/\n/\r/\t).
// JSON.parse alone silently corrupts them instead of reporting an error.
const TEX_JSON_ESCAPES = new Set(
	(
		'backslash bar barwedge bcirc because begin beta beth between bf bgroup big Big bigcap bigcup bigg Bigg biggl biggr bigl Bigl bigm bigr Bigr bigodot bigoplus bigotimes bigsqcup bigtriangledown bigtriangleup biguplus bigvee bigwedge binom blacklozenge blacksquare blacktriangle blacktriangledown bmod bm boldsymbol bot bowtie boxed brace brack breve bullet ' +
		'fbox fcolorbox flat footnotesize forall frac ' +
		'nabla natural ne nearrow neg neq newcommand newline nexists ni nleftarrow nLeftarrow nleftrightarrow nLeftrightarrow nmid nonumber nopagebreak nor not notag notin nparallel nrightarrow nRightarrow nsim nsubseteq nsupseteq nu nwarrow ' +
		'rangle rbrace rbrack rceil Re ref renewcommand require restriction rfloor rho right rightarrow Rightarrow rightarrowtail rightharpoondown rightharpoonup rightleftharpoons rightrightarrows rightsquigarrow rightthreetimes rm root rVert rvert ' +
		'tag tan tanh tau tbinom text textbf textcolor textit textnormal textrm textsf textstyle texttt tfrac therefore theta thickspace thinspace tilde times tiny to top triangle triangledown triangleleft triangleq triangleright tt twoheadleftarrow twoheadrightarrow'
	).split(/\s+/)
);

function repairStringsAndTrailingCommas(text: string): string {
	let quoted = false,
		result = '';
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (char === '"') {
			quoted = !quoted;
			result += char;
			continue;
		}
		if (!quoted) {
			// Some models put a trailing comma after the last property/array item.
			if (char === ',' && /^\s*[}\]]/.test(text.slice(i + 1))) continue;
			result += char;
			continue;
		}
		if (char === '\\') {
			const next = text[i + 1];
			if (next === undefined) {
				result += char;
				continue;
			}
			const command = text.slice(i + 1).match(/^[A-Za-z]+/)?.[0] || '';
			const validEscape = /["\\/bfnrt]/.test(next) || (next === 'u' && /^[\da-fA-F]{4}/.test(text.slice(i + 2)));
			if (TEX_JSON_ESCAPES.has(command) || !validEscape) {
				result += '\\\\'; // Preserve the literal TeX slash; do not consume the command.
			} else {
				result += char + next;
				i++; // Already escaped slash/quote/unicode/newline: preserve it.
			}
		} else {
			result += char.charCodeAt(0) < 32 ? JSON.stringify(char).slice(1, -1) : char;
		}
	}
	return result;
}

function parseValue(text: string): any {
	try {
		return JSON.parse(repairStringsAndTrailingCommas(text));
	} catch {
		return undefined;
	}
}

/** Extract only closed outer JSON objects/arrays, respecting quoted braces and escaped quotes. */
export function* completeJSONBlocks(text: string): Generator<string> {
	let start = -1,
		quoted = false,
		escaped = false;
	const stack: string[] = [];
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (start < 0) {
			if (char !== '{' && char !== '[') continue;
			start = i;
			stack.push(char);
			quoted = escaped = false;
			continue;
		}
		if (quoted) {
			if (escaped) escaped = false;
			else if (char === '\\') escaped = true;
			else if (char === '"') quoted = false;
		} else if (char === '"') quoted = true;
		else if (char === '{' || char === '[') stack.push(char);
		else if (char === '}' || char === ']') {
			const opening = stack.pop();
			if (opening !== (char === '}' ? '{' : '[')) {
				start = -1;
				stack.length = 0;
				continue;
			}
			if (!stack.length) {
				yield text.slice(start, i + 1);
				start = -1;
			}
		}
	}
}

export function parseJSONLike(content: string): any {
	const direct = parseValue(content.trim());
	if (direct !== undefined) return direct;
	let parsed: any;
	for (const block of completeJSONBlocks(content)) {
		const value = parseValue(block);
		if (value !== undefined) parsed = value;
	}
	return parsed;
}

export const AI_JSON_ESCAPE_HINT = String.raw`输出必须是合法 JSON；公式里的反斜杠必须转义为两个反斜杠，例如 {"answer":"\\frac{a}{b}","answers":["\\frac{a}{b}"]}。字符串中的换行写成 \n。answers 每项对应一个答案/空格，不要按公式里的分号、竖线或换行拆分答案。`;

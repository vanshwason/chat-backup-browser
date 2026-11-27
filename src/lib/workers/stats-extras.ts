/**
 * Extra chat insights computed in the stats worker: top words and emoji,
 * longest daily streak, longest silence.
 */

// Filler words that would otherwise top every list (English + Hindi/Hinglish)
const STOPWORDS = new Set(
	`the and you that for are was with have this not but what all your can just
	they his her she him its our out get got had has how its let may now one see
	too who why yes yeah yea ok okay oh ohh hmm haha hahaha lol also than then
	there their them were been from will would could should about into only
	very much more some any like dont don't im i'm it's thats that's isn't cant
	can't didn't doesnt doesn't wasn't won't i've i'll you're youre what's
	hai hain nahi nhi kya toh tho bhi aur kar karo raha rahi rahe tha thi the
	mai main mein mera meri mere tera teri tere apna apni koi kuch kyu kyun
	haan han acha accha achha bas phir fir woh vo wo yeh ye yaar abhi kab
	jab tab sab ko ka ki ke se pe par hi na ho hua hui gaya gayi diya liya
	when where which while because even did does done doing gonna wanna gotta
	know think thing things sure good time really still well back going want
	need make made take come came said say tell told look first last next same
	other another every something anything nothing someone people here over
	after before again always never ever being doesn didn don isn wasn won ill
	these those yaa yaar haa noo
	message deleted edited omitted image video audio sticker media null`
		.split(/\s+/)
		.filter(Boolean),
);

const WORD = /[\p{L}\p{N}']+/gu;

export function addWords(counts: Map<string, number>, text: string): void {
	const normalized = text.toLowerCase().replace(/[‘’]/g, "'");
	for (const raw of normalized.match(WORD) ?? []) {
		const word = raw.replace(/^'+|'+$/g, '');
		if (word.length < 3 || STOPWORDS.has(word) || /^\d+$/.test(word)) continue;
		counts.set(word, (counts.get(word) ?? 0) + 1);
	}
}

export function addEmojis(counts: Map<string, number>, emojis: string[]): void {
	for (const e of emojis) counts.set(e, (counts.get(e) ?? 0) + 1);
}

export function topN(counts: Map<string, number>, n = 10): [string, number][] {
	return [...counts]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, n);
}

export interface Streak {
	days: number;
	start: string;
	end: string;
}

/** Longest run of consecutive calendar days with messages (keys YYYY-MM-DD). */
export function longestStreak(dateKeys: Iterable<string>): Streak | null {
	const days = [...dateKeys].sort();
	if (days.length === 0) return null;
	const dayNumber = (key: string) =>
		Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) /
		86_400_000;
	let best: Streak = { days: 1, start: days[0], end: days[0] };
	let runStart = days[0];
	let runLength = 1;
	for (let i = 1; i < days.length; i++) {
		if (dayNumber(days[i]) - dayNumber(days[i - 1]) === 1) {
			runLength++;
		} else {
			runStart = days[i];
			runLength = 1;
		}
		if (runLength > best.days)
			best = { days: runLength, start: runStart, end: days[i] };
	}
	return best;
}

export interface Silence {
	seconds: number;
	from: string;
	to: string;
}

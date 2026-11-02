// Finds and reads the workspace profile (omninoise.profile.yaml) for the scripts that need it.
//
// Lookup order: --profile <file>, then $OMNINOISE_PROFILE, then the nearest omninoise.profile.yaml
// in the project folder or any folder above it. A missing profile is not an error: the scripts
// fall back to neutral defaults and say so when a default matters.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type Profile = {
	brand?: { name?: string; hub?: string; logo?: string };
	/** Strings that must never appear in public text, captions or recordings. */
	ban?: string[];
	hashtag_ban?: string[];
};

export type LoadedProfile = { file: string; dir: string; profile: Profile };

const NAME = "omninoise.profile.yaml";

export function loadProfile(startDir: string, argv: string[] = process.argv): LoadedProfile | undefined {
	const flag = argv.indexOf("--profile");
	const explicit = (flag >= 0 ? argv[flag + 1] : undefined) ?? process.env.OMNINOISE_PROFILE;
	let file: string | undefined;
	if (explicit) {
		file = resolve(explicit);
		if (!existsSync(file)) throw new Error(`profile not found: ${file}`);
	} else {
		for (let dir = resolve(startDir); ; dir = dirname(dir)) {
			if (existsSync(join(dir, NAME))) {
				file = join(dir, NAME);
				break;
			}
			if (dirname(dir) === dir) break;
		}
	}
	if (!file) return undefined;
	const profile = (Bun.YAML.parse(readFileSync(file, "utf8")) ?? {}) as Profile;
	return { file, dir: dirname(file), profile };
}

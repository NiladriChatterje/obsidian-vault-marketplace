import { attachment } from './attachment';
import { note } from './note';
import { seller } from './seller';
import { vault } from './vault';

/**
 * An Obsidian vault is a folder of markdown files. Here it is one `vault`
 * document plus one `note` document per .md file (and an `attachment` per
 * non-markdown file), all pointing back at the vault.
 */
export const schemaTypes = [vault, note, attachment, seller];

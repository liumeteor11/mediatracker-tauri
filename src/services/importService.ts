
import { MediaItem, MediaType, CollectionCategory } from '../types/types';
import { v4 as uuidv4 } from 'uuid';

export type ImportSource = 'douban' | 'trakt' | 'letterboxd' | 'csv_custom';

interface ImportResult {
    success: number;
    failed: number;
    errors: string[];
    items: MediaItem[];
}

// Simple CSV Parser handling quotes
const parseCSV = (text: string): string[][] => {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (inQuotes) {
            if (char === '"' && nextChar === '"') {
                currentCell += '"';
                i++;
            } else if (char === '"') {
                inQuotes = false;
            } else {
                currentCell += char;
            }
        } else {
            if (char === '"') {
                inQuotes = true;
            } else if (char === ',') {
                currentRow.push(currentCell.trim());
                currentCell = '';
            } else if (char === '\n' || char === '\r') {
                if (currentCell || currentRow.length > 0) {
                    currentRow.push(currentCell.trim());
                    rows.push(currentRow);
                }
                currentRow = [];
                currentCell = '';
                if (char === '\r' && nextChar === '\n') i++;
            } else {
                currentCell += char;
            }
        }
    }
    if (currentCell || currentRow.length > 0) {
        currentRow.push(currentCell.trim());
        rows.push(currentRow);
    }
    return rows;
};

export const parseImportFile = async (content: string, source: ImportSource): Promise<ImportResult> => {
    const rows = parseCSV(content);
    const result: ImportResult = { success: 0, failed: 0, errors: [], items: [] };

    if (rows.length < 2) {
        result.errors.push("File appears to be empty or invalid CSV");
        return result;
    }

    const headers = rows[0].map(h => h.toLowerCase());
    const dataRows = rows.slice(1);

    dataRows.forEach((row, index) => {
        if (row.length < 2) return; // Skip empty rows

        try {
            let item: Partial<MediaItem> = {
                id: uuidv4(),
                addedAt: new Date().toISOString(),
                lastEditedAt: Date.now(),
                category: CollectionCategory.WATCHED, // Default to watched
                isOngoing: false,
                hasNewUpdate: false,
                notificationEnabled: false,
                userReview: '',
            };

            if (source === 'letterboxd') {
                // Letterboxd: Name, Year, Letterboxd URI, Rating10, Watched Date, Tags
                const nameIdx = headers.indexOf('name');
                const yearIdx = headers.indexOf('year');
                const ratingIdx = headers.indexOf('rating'); // 0-5
                const dateIdx = headers.indexOf('watched date');

                if (nameIdx === -1) throw new Error("Missing 'Name' column");

                item.title = row[nameIdx];
                item.releaseDate = row[yearIdx] || '';
                item.type = MediaType.MOVIE; // Letterboxd is mostly movies
                
                if (dateIdx !== -1 && row[dateIdx]) {
                    item.addedAt = new Date(row[dateIdx]).toISOString();
                }
                
                if (ratingIdx !== -1 && row[ratingIdx]) {
                    // Letterboxd 0-5 -> 0-10 string
                    const r = parseFloat(row[ratingIdx]);
                    if (!isNaN(r)) item.rating = `${r * 2}/10`;
                }
            } else if (source === 'trakt') {
                // Trakt History: Action, Type, Title, Year, ID, Rating, Timestamp
                // This varies by export type (History vs Ratings). Assuming History/Ratings merged or specific format.
                // Common Trakt CSV: Title, Year, Release, Rating, WatchedAt
                const titleIdx = headers.indexOf('title');
                const yearIdx = headers.indexOf('year');
                const ratingIdx = headers.indexOf('rating'); // 1-10
                const typeIdx = headers.indexOf('type'); // movie, show, episode

                if (titleIdx === -1) throw new Error("Missing 'Title' column");

                item.title = row[titleIdx];
                item.releaseDate = row[yearIdx] || '';
                
                const type = row[typeIdx]?.toLowerCase();
                if (type === 'show' || type === 'episode') item.type = MediaType.TV_SERIES;
                else item.type = MediaType.MOVIE;

                if (ratingIdx !== -1 && row[ratingIdx]) {
                    item.rating = `${row[ratingIdx]}/10`;
                }
            } else if (source === 'douban') {
                // Douban Export (Userscript often used): 标题, 评分, 标记时间, 评论, etc.
                // Headers might be Chinese or mapped. Let's assume common Chinese headers.
                const titleIdx = headers.findIndex(h => h.includes('标题') || h.includes('title'));
                const dateIdx = headers.findIndex(h => h.includes('时间') || h.includes('date'));
                const ratingIdx = headers.findIndex(h => h.includes('评分') || h.includes('rating'));
                const commentIdx = headers.findIndex(h => h.includes('评论') || h.includes('comment'));

                if (titleIdx === -1) throw new Error("Missing 'Title/标题' column");

                item.title = row[titleIdx];
                if (dateIdx !== -1 && row[dateIdx]) item.addedAt = new Date(row[dateIdx]).toISOString();
                if (ratingIdx !== -1 && row[ratingIdx]) {
                    // Douban is 1-5 stars usually, or 2/4/6/8/10. 
                    // If it's 1-5, x2. If >5, assume 10 scale.
                    const r = parseFloat(row[ratingIdx]);
                    if (!isNaN(r)) item.rating = r <= 5 ? `${r * 2}/10` : `${r}/10`;
                }
                if (commentIdx !== -1) item.userReview = row[commentIdx];
                item.type = MediaType.MOVIE; // Default, user can change later or we guess?
            }

            // Validation
            if (!item.title) throw new Error("No title found");
            
            // Fill defaults
            if (!item.description) item.description = "Imported from " + source;
            if (!item.directorOrAuthor) item.directorOrAuthor = "";
            if (!item.cast) item.cast = [];

            result.items.push(item as MediaItem);
            result.success++;
        } catch (e: any) {
            result.failed++;
            result.errors.push(`Row ${index + 2}: ${e.message}`);
        }
    });

    return result;
};

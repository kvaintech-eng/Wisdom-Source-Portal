export function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let cellClosed = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (quoted) {
      if (character === '"') {
        if (content[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
          cellClosed = true;
        }
      } else {
        cell += character;
      }
      continue;
    }

    if (cellClosed && character !== ',' && character !== '\r' && character !== '\n') {
      throw new Error('Unexpected character after a quoted CSV value.');
    }
    if (character === '"' && cell.length === 0 && !cellClosed) {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
      cellClosed = false;
    } else if (character === '\r' || character === '\n') {
      row.push(cell);
      if (row.some((value) => value.trim().length > 0)) rows.push(row);
      row = [];
      cell = '';
      cellClosed = false;
      if (character === '\r' && content[index + 1] === '\n') index += 1;
    } else {
      cell += character;
    }
  }

  if (quoted) {
    throw new Error('CSV contains an unclosed quoted value.');
  }
  if (cell.length > 0 || row.length > 0 || cellClosed) {
    row.push(cell);
    if (row.some((value) => value.trim().length > 0)) rows.push(row);
  }

  return rows;
}

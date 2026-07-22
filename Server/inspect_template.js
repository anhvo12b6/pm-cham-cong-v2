const ExcelJS = require('exceljs');
const path = require('path');

async function inspect() {
  const wb = new ExcelJS.Workbook();
  const templatePath = path.join(__dirname, '..', 'ImportWorkDayDailyTemplate.xlsx');
  await wb.xlsx.readFile(templatePath);

  wb.eachSheet((sheet, id) => {
    console.log(`=== Sheet ID: ${id}, Name: "${sheet.name}" ===`);
    console.log(`RowCount: ${sheet.rowCount}, ColCount: ${sheet.columnCount}`);

    // Check merged cells
    console.log('Merged cells:', sheet.model.merges || sheet._merges);

    // Print top 20 rows
    for (let r = 1; r <= Math.min(sheet.rowCount, 20); r++) {
      const row = sheet.getRow(r);
      const vals = [];
      for (let c = 1; c <= Math.max(row.cellCount, 25); c++) {
        const cell = row.getCell(c);
        if (cell.value !== null && cell.value !== undefined && cell.value !== '') {
          vals.push(`[Col ${c} / ${cell.address}]: ${JSON.stringify(cell.value)} (type: ${cell.type})`);
        }
      }
      if (vals.length > 0) {
        console.log(`Row ${r}:`, vals.join(' | '));
      }
    }
  });
}

inspect().catch(err => console.error(err));

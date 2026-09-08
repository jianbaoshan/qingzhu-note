// Excel 工作线程 - 在独立线程中处理 Excel 解析，避免阻塞主进程
const { parentPort, workerData } = require('worker_threads');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const { filePath, maxRows } = workerData;
const asData = workerData.format === 'data';

try {
  // 检查文件大小
  const stat = fs.statSync(filePath);
  if (stat.size > 50 * 1024 * 1024) {
    parentPort.postMessage({ type: 'error', content: '文件过大（超过 50MB），无法预览，请使用外部程序打开' });
    return;
  }

  const workbook = xlsx.readFile(filePath, { cellStyles: true, cellFormula: false });

  // 结构化数据格式：供应用内 Excel 交互表格组件（x-spreadsheet）使用
  if (asData) {
    const dataSheets = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      let totalRows = 0;
      const ref = sheet['!ref'];
      if (ref) {
        const range = xlsx.utils.decode_range(ref);
        totalRows = range.e.r - range.s.r + 1;
        if (totalRows > maxRows) {
          range.e.r = range.s.r + maxRows - 1;
          sheet['!ref'] = xlsx.utils.encode_range(range);
        }
      }
      const json = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false });
      const rowsObj = {};
      json.forEach((rowArr, r) => {
        if (!Array.isArray(rowArr)) return;
        const cells = {};
        rowArr.forEach((cellVal, c) => {
          const v = (cellVal === undefined || cellVal === null) ? '' : cellVal;
          cells[c] = { text: String(v), value: v };
        });
        rowsObj[r] = { cells };
      });
      const merges = (sheet['!merges'] || []).map((m) => xlsx.utils.encode_range(m));
      const cols = [];
      if (sheet['!cols']) {
        sheet['!cols'].forEach((col) => {
          cols.push({ width: col.wpx || (col.wch ? col.wch * 8 : 80) });
        });
      }
      dataSheets.push({ name: sheetName, rows: rowsObj, merges, cols });
    }
    parentPort.postMessage({ type: 'excel_data', sheets: dataSheets });
    return;
  }

  let html = '';

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];

    // 检查行数
    let totalRows = 0;
    const ref = sheet['!ref'];
    let truncated = false;
    if (ref) {
      const range = xlsx.utils.decode_range(ref);
      totalRows = range.e.r - range.s.r + 1;
      if (totalRows > maxRows) {
        range.e.r = range.s.r + maxRows - 1;
        sheet['!ref'] = xlsx.utils.encode_range(range);
        truncated = true;
      }
    }

    // 手动生成 HTML 表格（轻量级，避免 sheet_to_html 的额外开销）
    const json = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    if (json.length > 0) {
      const colWidths = sheet['!cols'] || [];
      const colStyles = [];
      colWidths.forEach((col, idx) => {
        if (col && col.wpx) {
          colStyles[idx] = ` style="min-width:${col.wpx}px;max-width:${Math.min(col.wpx * 3, 500)}px"`;
        } else if (col && col.wch) {
          colStyles[idx] = ` style="min-width:${col.wch * 8}px;max-width:${Math.min(col.wch * 24, 500)}px"`;
        }
      });

      const merges = sheet['!merges'] || [];
      const mergeMap = {};
      merges.forEach(m => {
        for (let r = m.s.r; r <= m.e.r; r++) {
          for (let c = m.s.c; c <= m.e.c; c++) {
            if (r === m.s.r && c === m.s.c) continue;
            mergeMap[`${r},${c}`] = true;
          }
        }
      });

      let tableHtml = '<table class="excel-table">';
      const displayRows = Math.min(json.length, maxRows);
      for (let r = 0; r < displayRows; r++) {
        if (mergeMap[`${r},0`] && json[r].length === 0) continue;
        tableHtml += '<tr>';
        const maxCols = json.reduce((max, row) => Math.max(max, row.length), 0);
        for (let c = 0; c < maxCols; c++) {
          if (mergeMap[`${r},${c}`]) continue;
          const cell = json[r] && json[r][c] !== undefined ? json[r][c] : '';
          const val = String(cell);
          const escaped = val.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

          let mergeAttr = '';
          for (const m of merges) {
            if (m.s.r === r && m.s.c === c) {
              const rowspan = m.e.r - m.s.r + 1;
              const colspan = m.e.c - m.s.c + 1;
              if (rowspan > 1 || colspan > 1) {
                mergeAttr = ` rowspan="${rowspan}" colspan="${colspan}"`;
              }
              break;
            }
          }

          const cellAddr = xlsx.utils.encode_cell({ r, c });
          const cellObj = sheet[cellAddr];
          let cellStyle = '';
          if (cellObj && cellObj.s !== undefined) {
            const style = workbook.styles && workbook.styles[cellObj.s];
            if (style) {
              const font = style.font;
              const fill = style.fill;
              const alignment = style.alignment;
              if (font) {
                if (font.bold) cellStyle += 'font-weight:bold;';
                if (font.italic) cellStyle += 'font-style:italic;';
                if (font.sz) cellStyle += `font-size:${font.sz}pt;`;
                if (font.color && font.color.rgb) cellStyle += `color:#${font.color.rgb};`;
              }
              if (fill && fill.fgColor && fill.fgColor.rgb) {
                cellStyle += `background-color:#${fill.fgColor.rgb};`;
              }
              if (alignment) {
                if (alignment.horizontal) cellStyle += `text-align:${alignment.horizontal};`;
                if (alignment.vertical) cellStyle += `vertical-align:${alignment.vertical};`;
              }
            }
          }
          const isHeader = r === 0;
          const tag = isHeader ? 'th' : 'td';
          const widthStyle = colStyles[c] || '';
          tableHtml += `<${tag}${mergeAttr}${widthStyle} style="${cellStyle}">${escaped}</${tag}>`;
        }
        tableHtml += '</tr>';
      }
      tableHtml += '</table>';

      if (truncated && totalRows > maxRows) {
        tableHtml += `<div class="excel-truncate-notice">仅显示前 ${maxRows} 行（共 ${totalRows} 行），完整文件请使用外部程序打开</div>`;
      }

      html += `<div class="excel-sheet"><h3>${sheetName}</h3>${tableHtml}</div>`;
    } else {
      html += `<div class="excel-sheet"><h3>${sheetName}</h3><p style="color:var(--text-secondary);padding:12px;text-align:center">此工作表为空</p></div>`;
    }
  }

  parentPort.postMessage({ type: 'html', content: html || '<p>Excel 文件为空</p>' });
} catch (e) {
  parentPort.postMessage({ type: 'error', content: 'Excel 文件预览失败：' + e.message });
}
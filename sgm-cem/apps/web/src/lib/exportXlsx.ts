import ExcelJS from 'exceljs'

// Palette CEM — cohérente avec les PDF (reçus, bordereaux, rapports).
const CEM_GREEN = 'FF0F4A0F'
const CEM_GREEN_LIGHT = 'FFE8F5E8'
const CEM_GOLD = 'FFF5C400'
const BORDER_COLOR = 'FFE2E8F0'

export interface XlsxColumn {
  header: string
  key: string
  width?: number
  /** 'number' applique un format milliers + alignement droite. 'date' aligne à gauche, format simple. */
  type?: 'text' | 'number' | 'date'
}

/**
 * Génère et télécharge un vrai classeur Excel (.xlsx) mis en forme :
 * bandeau de titre, en-tête coloré, bordures, lignes alternées, colonnes
 * numériques formatées. Remplace les anciens exports CSV bruts — le CSV
 * est un format texte qui ne peut pas porter de couleurs ni de bordures.
 */
async function fetchLogoBuffer(): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch('/icon-192.png')
    if (!res.ok) return null
    return await res.arrayBuffer()
  } catch {
    return null
  }
}

export async function downloadXlsx(opts: {
  filename: string
  sheetName: string
  title: string
  columns: XlsxColumn[]
  rows: Record<string, unknown>[]
}): Promise<void> {
  const { filename, sheetName, title, columns, rows } = opts
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'SGM-CEM'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: 3 }],
  })

  sheet.columns = columns.map(c => ({ key: c.key, width: c.width ?? Math.max(14, c.header.length + 4) }))

  // ── Bandeau de titre (avec logo) ───────────────────────────────────
  sheet.getRow(1).height = 30
  sheet.getRow(2).height = 20

  // Colonne 1 sert de socle au logo — bande verte continue sur les 2 lignes.
  sheet.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CEM_GREEN } }
  sheet.getCell(2, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CEM_GREEN } }

  const logoBuffer = await fetchLogoBuffer()
  if (logoBuffer) {
    const imageId = workbook.addImage({ buffer: logoBuffer, extension: 'png' })
    sheet.addImage(imageId, { tl: { col: 0.12, row: 0.1 }, ext: { width: 40, height: 40 } })
  }

  if (columns.length > 1) {
    sheet.mergeCells(1, 2, 1, columns.length)
    sheet.mergeCells(2, 2, 2, columns.length)
  }
  const richTitleCell = sheet.getCell(1, 2)
  richTitleCell.value = `SGM-CEM — ${title}`
  richTitleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }
  richTitleCell.alignment = { vertical: 'bottom', horizontal: 'left' }
  richTitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CEM_GREEN } }

  const subtitleCell = sheet.getCell(2, 2)
  subtitleCell.value = `Généré le ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${rows.length} ligne(s)`
  subtitleCell.font = { italic: true, size: 9.5, color: { argb: 'FFDCEEDC' } }
  subtitleCell.alignment = { vertical: 'top', horizontal: 'left' }
  subtitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CEM_GREEN } }

  // ── En-tête des colonnes ──────────────────────────────────────────
  const headerRow = sheet.getRow(3)
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = col.header
    cell.font = { bold: true, size: 10.5, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CEM_GREEN } }
    cell.alignment = { vertical: 'middle', horizontal: col.type === 'number' ? 'right' : 'left' }
    cell.border = {
      top: { style: 'thin', color: { argb: BORDER_COLOR } },
      bottom: { style: 'medium', color: { argb: CEM_GOLD } },
      left: { style: 'thin', color: { argb: BORDER_COLOR } },
      right: { style: 'thin', color: { argb: BORDER_COLOR } },
    }
  })
  headerRow.height = 22

  // ── Lignes de données ──────────────────────────────────────────────
  rows.forEach((row, rowIndex) => {
    const excelRow = sheet.getRow(rowIndex + 4)
    const striped = rowIndex % 2 === 1
    columns.forEach((col, colIndex) => {
      const cell = excelRow.getCell(colIndex + 1)
      const raw = row[col.key]
      cell.value = col.type === 'number' ? (typeof raw === 'number' ? raw : Number(raw) || 0) : (raw as string | number | null | undefined) ?? ''
      if (col.type === 'number') {
        cell.numFmt = '#,##0 "FCFA"'
        cell.alignment = { horizontal: 'right' }
      }
      cell.font = { size: 10.5, color: { argb: 'FF0F172A' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: striped ? CEM_GREEN_LIGHT : 'FFFFFFFF' } }
      cell.border = {
        top: { style: 'thin', color: { argb: BORDER_COLOR } },
        bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
        left: { style: 'thin', color: { argb: BORDER_COLOR } },
        right: { style: 'thin', color: { argb: BORDER_COLOR } },
      }
    })
  })

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

import { startTransition, useDeferredValue, useEffect, useId, useRef, useState } from 'react'
import { Bar, Pie } from 'react-chartjs-2'
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from 'chart.js'
import ChartDataLabels from 'chartjs-plugin-datalabels'
import './App.css'

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  ChartDataLabels,
)

const SHORTAGE_MARKERS = new Set(['⚠️ SHORTAGE', 'âš ï¸ SHORTAGE'])
const HOLD_EXPORT_COLUMNS = [
  'dsn',
  'serial',
  'variant',
  'order_number',
  'description',
  'model',
  'work_content',
  'vehicle_type',
  'region',
  'state',
  'hold_status',
  'hold_reason',
  'vehicle_start_time',
]
const SKIP_EXPORT_COLUMNS = [
  'dsn',
  'serial',
  'variant',
  'order_number',
  'description',
  'model',
  'work_content',
  'vehicle_type',
  'region',
  'status',
  'vehicle_order_state',
  'skip_reason',
  'vehicle_start_time',
]
const HOLD_TABLE_COLUMNS = [
  ['DSN', 'dsn'],
  ['Serial No.', 'serial'],
  ['Variant', 'variant'],
  ['Order Number', 'order_number'],
  ['Description', 'description'],
  ['Model', 'model'],
  ['Work Content', 'work_content'],
  ['Type', 'vehicle_type'],
  ['Region', 'region'],
  ['State', 'vehicle_order_state'],
  ['Hold Status', 'hold_status'],
  ['Hold Reason', 'hold_reason'],
  ['Vehicle Start Time', 'vehicle_start_time'],
]
const SKIP_TABLE_COLUMNS = [
  ['DSN', 'dsn'],
  ['Serial No.', 'serial'],
  ['Variant', 'variant'],
  ['Order Number', 'order_number'],
  ['Description', 'description'],
  ['Model', 'model'],
  ['Work Content', 'work_content'],
  ['Type', 'vehicle_type'],
  ['Region', 'region'],
  ['Status', 'status'],
  ['State', 'vehicle_order_state'],
  ['Skip Reason', 'skip_reason'],
  ['Vehicle Start Time', 'vehicle_start_time'],
]
const PIE_HOLD_COLORS = ['#d9485f', '#f08949', '#ef7d95', '#5f50cf', '#15938f', '#3c91e6', '#9aa8bc', '#ffc34d']
const PIE_SKIP_COLORS = ['#ffc145', '#3cb371', '#3c91e6', '#2ec4b6', '#7c4dff', '#ef476f', '#ff8c42', '#9aa8bc']

function createShortageRow() {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    part: '',
    ref: '',
    qty: '',
    file: null,
  }
}

function normalizeData(rawData) {
  return {
    summary: rawData?.summary ?? {},
    gaps: Array.isArray(rawData?.gaps) ? rawData.gaps : [],
    holdOrders: Array.isArray(rawData?.hold_orders) ? rawData.hold_orders : [],
    skipOrders: Array.isArray(rawData?.skip_orders) ? rawData.skip_orders : [],
    previewColumns: Array.isArray(rawData?.preview_columns) ? rawData.preview_columns : [],
    previewData: Array.isArray(rawData?.preview_data) ? rawData.preview_data : [],
  }
}

function normalizeIdentifier(value) {
  return String(value ?? '')
    .trim()
    .replace(/\.0$/, '')
    .toUpperCase()
}
function getRowIdentifiers(row) {
  const serial = row?.serial ?? row?.['Serial Number'] ?? row?.Serial ?? ''
  const dsn = row?.dsn ?? row?.DSN ?? row?.['Delivery Sequence Number'] ?? ''
  const orderNumber = row?.order_number ?? row?.['Order Number'] ?? row?.['Order No'] ?? ''
  const variant = row?.variant ?? row?.Variant ?? ''

  return {
    serial: normalizeIdentifier(serial),
    dsn: normalizeIdentifier(dsn),
    orderNumber: normalizeIdentifier(orderNumber),
    variant: normalizeIdentifier(variant),
  }
}

function getVehicleKey(row, kind) {
  const ids = getRowIdentifiers(row)
  return [ids.serial, ids.dsn, ids.orderNumber, ids.variant, kind].filter(Boolean).join('::')
}

function getVehicleLookupKeys(row, kind) {
  const ids = getRowIdentifiers(row)
  const keys = [
    [ids.serial, kind],
    [ids.orderNumber, kind],
    [ids.dsn, kind],
    [ids.serial, ids.orderNumber, kind],
    [ids.serial, ids.dsn, kind],
    [ids.serial, ids.variant, kind],
    [ids.orderNumber, ids.variant, kind],
    [ids.serial, ids.orderNumber, ids.variant, kind],
    [ids.serial, ids.dsn, ids.orderNumber, ids.variant, kind],
  ]

  return [...new Set(keys.map((parts) => parts.filter(Boolean).join('::')).filter(Boolean))]
}

function enrichAnalysisWithReasons(analysis, holdReasons, skipReasons) {
  if (!analysis) {
    return null
  }

  const previewReasonColumn = 'Skip/Hold Reason'
  const previewColumns = analysis.previewColumns.filter(
    (column) => !['Hold Reason', 'Skip Reason', previewReasonColumn].includes(column),
  )
  const statusIndex = previewColumns.indexOf('Status')
  const previewReasonInsertIndex = statusIndex === -1 ? 0 : statusIndex + 1
  previewColumns.splice(previewReasonInsertIndex, 0, previewReasonColumn)

  const holdStatusColumn = 'Hold Status'

  if (!previewColumns.includes(holdStatusColumn) && analysis.previewColumns.includes(holdStatusColumn)) {
    const statusInsertIndex = previewColumns.indexOf('Status')
    previewColumns.splice(statusInsertIndex === -1 ? previewReasonInsertIndex : statusInsertIndex + 1, 0, holdStatusColumn)
  }

  const holdOrders = analysis.holdOrders.map((row) => ({
    ...row,
    hold_reason: holdReasons[getVehicleKey(row, 'hold')] || '',
  }))

  const skipOrders = analysis.skipOrders.map((row) => ({
    ...row,
    skip_reason: skipReasons[getVehicleKey(row, 'skip')] || '',
  }))

  const holdReasonLookup = new Map()
  for (const row of holdOrders) {
    for (const key of getVehicleLookupKeys(row, 'hold')) {
      holdReasonLookup.set(key, row.hold_reason)
    }
  }

  const skipReasonLookup = new Map()
  for (const row of skipOrders) {
    for (const key of getVehicleLookupKeys(row, 'skip')) {
      skipReasonLookup.set(key, row.skip_reason)
    }
  }

  const previewData = analysis.previewData.map((row) => {
    const holdReason = getVehicleLookupKeys(row, 'hold').find((key) => holdReasonLookup.has(key))
    const skipReason = getVehicleLookupKeys(row, 'skip').find((key) => skipReasonLookup.has(key))
    const mergedReason = holdReason
      ? holdReasonLookup.get(holdReason) || ''
      : skipReason
        ? skipReasonLookup.get(skipReason) || ''
        : ''

    return {
      ...row,
      [previewReasonColumn]: mergedReason,
    }
  })

  return {
    ...analysis,
    holdOrders,
    skipOrders,
    previewColumns,
    previewData,
  }
}

function escapeCsvValue(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

function triggerDownload(fileName, columns, rows) {
  const csv = [
    columns.map(escapeCsvValue).join(','),
    ...rows.map((row) => columns.map((column) => escapeCsvValue(row[column])).join(',')),
  ].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function getShortageCount(row) {
  return Object.values(row).filter((value) => SHORTAGE_MARKERS.has(String(value))).length
}

function getNextWorkingDay(date, holidays) {
  const nextDate = new Date(date)

  while (true) {
    const key = formatDateKey(nextDate)
    if (nextDate.getDay() !== 0 && !holidays.includes(key)) {
      return nextDate
    }
    nextDate.setDate(nextDate.getDate() + 1)
  }
}

function formatDateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatLineTime(date) {
  const hours = date.getHours() % 12 || 12
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const meridiem = date.getHours() >= 12 ? 'PM' : 'AM'
  return `${hours}:${minutes} ${meridiem}`
}

function applySequence(previewColumns, previewData, capacityValue, startDate, holidays) {
  if (!Array.isArray(previewColumns) || !Array.isArray(previewData) || previewData.length === 0) {
    return {
      columns: previewColumns ?? [],
      rows: previewData ?? [],
      statusLabel: 'Sequence not applied yet',
      statusTone: 'neutral',
      taktTime: null,
    }
  }

  if (!capacityValue || !startDate) {
    return {
      columns: [...previewColumns],
      rows: structuredClone(previewData),
      statusLabel: 'Sequence unapplied (missing inputs)',
      statusTone: 'warning',
      taktTime: null,
    }
  }

  const baseCapacity = Number.parseInt(capacityValue, 10)
  if (!Number.isFinite(baseCapacity) || baseCapacity <= 0) {
    return {
      columns: [...previewColumns],
      rows: structuredClone(previewData),
      statusLabel: 'Sequence unapplied (invalid capacity)',
      statusTone: 'warning',
      taktTime: null,
    }
  }

  const [year, month, day] = startDate.split('-').map((value) => Number.parseInt(value, 10))
  let currentDate = getNextWorkingDay(new Date(year, month - 1, day), holidays)
  const sequenceColumns = ['Line in sequence', 'Production Date', 'Line in time']
  const columns = [...previewColumns]
  const statusIndex = columns.indexOf('Status')

  if (statusIndex === -1) {
    columns.unshift(...sequenceColumns)
  } else {
    columns.splice(statusIndex + 1, 0, ...sequenceColumns)
  }

  const rows = structuredClone(previewData)
  const standardTotalMinutes = 1070
  const thursdayTotalMinutes = 1010
  let counter = 1
  let sequenceStarted = false
  let currentDayMinutes = standardTotalMinutes
  let todayCapacity = baseCapacity
  let taktTime = currentDayMinutes / todayCapacity
  let currentTime = new Date(currentDate)
  currentTime.setHours(7, 0, 0, 0)

  for (const row of rows) {
    const status = String(row.Status ?? '').trim().toUpperCase()
    if (!sequenceStarted && status === 'TRIM LINE') {
      sequenceStarted = true
    }

    if (!sequenceStarted) {
      row['Line in sequence'] = ''
      row['Production Date'] = ''
      row['Line in time'] = ''
      continue
    }

    if (counter === 1) {
      currentDayMinutes = currentDate.getDay() === 4 ? thursdayTotalMinutes : standardTotalMinutes
      todayCapacity =
        currentDate.getDay() === 4
          ? Math.floor(baseCapacity * (thursdayTotalMinutes / standardTotalMinutes))
          : baseCapacity
      taktTime = currentDayMinutes / todayCapacity

      currentTime = new Date(currentDate)
      currentTime.setHours(7, 0, 0, 0)
    }

    row['Line in sequence'] = counter
    row['Production Date'] = formatDateKey(currentDate)
    row['Line in time'] = formatLineTime(currentTime)

    currentTime = new Date(currentTime.getTime() + taktTime * 60000)
    const timeInMinutes = currentTime.getHours() * 60 + currentTime.getMinutes()

    if (timeInMinutes >= 11 * 60 + 30 && timeInMinutes < 12 * 60) {
      currentTime.setHours(12, 0, 0, 0)
    } else if (timeInMinutes >= 20 * 60 + 30 && timeInMinutes < 21 * 60) {
      currentTime.setHours(21, 0, 0, 0)
    }

    counter += 1
    if (counter > todayCapacity) {
      counter = 1
      currentDate.setDate(currentDate.getDate() + 1)
      currentDate = getNextWorkingDay(currentDate, holidays)
    }
  }

  return {
    columns,
    rows,
    statusLabel: 'Sequence and dates applied',
    statusTone: 'success',
    taktTime: Number.isFinite(taktTime) ? taktTime.toFixed(2) : null,
  }
}

function buildInference(rows, shortageParts) {
  if (!Array.isArray(shortageParts) || shortageParts.length === 0) {
    return []
  }

  const allDates = [...new Set(rows.map((row) => row['Production Date']).filter(Boolean))].sort()

  return shortageParts.map((part) => {
    const connectedRows = rows.filter((row) => row[part])
    const impactedRows = connectedRows.filter((row) => SHORTAGE_MARKERS.has(String(row[part])))
    const scheduledConnectedRows = connectedRows.filter((row) => row['Production Date'])
    const scheduledImpactedRows = impactedRows.filter((row) => row['Production Date'])

    if (impactedRows.length === 0) {
      return {
        part,
        covered: true,
      }
    }

    const shortageDate = scheduledImpactedRows[0]?.['Production Date'] ?? 'Not Scheduled'
    const connectingModels = [...new Set(impactedRows.map((row) => row.Model || 'Unknown'))].join(', ')
    const firstDaySequences = scheduledImpactedRows
      .filter((row) => row['Production Date'] === shortageDate)
      .map((row) => row['Line in sequence'])
      .filter(Boolean)
      .join(', ')

    let forecast = []
    if (scheduledImpactedRows.length > 0) {
      const startIndex = allDates.indexOf(shortageDate)
      const forecastDates = allDates.slice(startIndex, startIndex + 4)
      forecast = forecastDates.map((dateKey) => ({
        date: dateKey,
        dayPlan: scheduledConnectedRows.filter((row) => row['Production Date'] === dateKey).length,
        shortageQty: scheduledImpactedRows.filter((row) => row['Production Date'] === dateKey).length,
      }))
    }

    return {
      part,
      covered: false,
      shortageDate,
      connectingModels,
      firstDaySequences: firstDaySequences || 'None',
      forecast,
      unscheduled: scheduledImpactedRows.length === 0,
    }
  })
}

function buildPieData(stratification, palette) {
  const labels = Object.keys(stratification ?? {})
  const values = Object.values(stratification ?? {})

  return {
    labels: labels.map((label, index) => `${label} (${values[index]})`),
    datasets: [
      {
        data: values,
        backgroundColor: palette,
        borderWidth: 0,
      },
    ],
  }
}

function buildBarOptions(orders, categoryKey) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 24 } },
    plugins: {
      legend: { display: false },
      datalabels: {
        color: '#12345b',
        anchor: 'end',
        align: 'top',
        font: { weight: 'bold', size: 13 },
        formatter: (value) => (value > 0 ? value : ''),
      },
      tooltip: {
        callbacks: {
          label(context) {
            const count = context.raw
            if (count === 0) {
              return 'Count: 0'
            }

            const breakdown = {}
            for (const order of orders) {
              if (order[categoryKey] === context.label) {
                const model = order.model || 'Unknown'
                breakdown[model] = (breakdown[model] || 0) + 1
              }
            }

            return [
              `Total Count: ${count}`,
              '',
              ...Object.keys(breakdown)
                .sort()
                .map((key) => `• ${key}: ${breakdown[key]}`),
            ]
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: { precision: 0 },
        grid: { color: 'rgba(18, 52, 91, 0.12)' },
      },
      x: {
        grid: { display: false },
      },
    },
  }
}

function buildSimpleBarData(labels, values, colors) {
  return {
    labels,
    datasets: [
      {
        data: values,
        backgroundColor: colors,
        borderRadius: 10,
        borderSkipped: false,
      },
    ],
  }
}

function getTableCellClass(column, value, shortageCount) {
  if (SHORTAGE_MARKERS.has(String(value))) {
    return 'cell-shortage'
  }
  if (value === 'Covered') {
    return 'cell-covered'
  }
  if (
    ['Line in sequence', 'Production Date', 'Line in time'].includes(column) &&
    value !== '' &&
    value !== null &&
    value !== undefined
  ) {
    return shortageCount > 0 ? 'cell-sequence-alert' : 'cell-sequence'
  }
  return ''
}

function getPreviewRowClass(shortageCount) {
  if (shortageCount === 1) return 'row-shortage-1'
  if (shortageCount === 2) return 'row-shortage-2'
  if (shortageCount === 3) return 'row-shortage-3'
  if (shortageCount >= 4) return 'row-shortage-4'
  return ''
}

function StatCard({ label, value, tone, icon }) {
  return (
    <div className="col-6 col-md-4">
      <div className={`stat-card stat-card-${tone}`}>
        <div className="stat-label">
          <i className={`bi ${icon}`} />
          <span>{label}</span>
        </div>
        <div className="stat-value">{value}</div>
      </div>
    </div>
  )
}

function EmptyChart({ message }) {
  return <div className="chart-empty">{message}</div>
}

function PieChartCard({ title, icon, data, emptyMessage }) {
  const hasData = data.labels.length > 0
  return (
    <div className="col-lg-6">
      <div className="panel-card h-100">
        <div className="panel-card-header">
          <span>
            <i className={`bi ${icon}`} /> {title}
          </span>
        </div>
        <div className="panel-card-body chart-body">
          {hasData ? (
            <Pie
              data={data}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    position: 'right',
                    labels: { boxWidth: 14, font: { size: 12, weight: 'bold' } },
                  },
                  datalabels: { display: false },
                },
              }}
            />
          ) : (
            <EmptyChart message={emptyMessage} />
          )}
        </div>
      </div>
    </div>
  )
}

function BarChartCard({ title, icon, labels, values, colors, orders, categoryKey }) {
  const hasData = Math.max(...values, 0) > 0
  return (
    <div className="col-sm-6 col-md-4 col-lg-2">
      <div className="panel-card h-100 compact-card">
        <div className="panel-card-header compact-header">
          <span>
            <i className={`bi ${icon}`} /> {title}
          </span>
        </div>
        <div className="panel-card-body mini-chart-body">
          {hasData ? (
            <Bar data={buildSimpleBarData(labels, values, colors)} options={buildBarOptions(orders, categoryKey)} />
          ) : (
            <EmptyChart message="No data" />
          )}
        </div>
      </div>
    </div>
  )
}

function Toasts({ items, onDismiss }) {
  return (
    <div className="toast-stack">
      {items.map((toast) => (
        <div key={toast.id} className={`alert alert-${toast.type} shadow-sm`} role="alert">
          <div className="d-flex justify-content-between gap-3 align-items-start">
            <span>{toast.message}</span>
            <button type="button" className="btn-close" aria-label="Close" onClick={() => onDismiss(toast.id)} />
          </div>
        </div>
      ))}
    </div>
  )
}

function ResultsTable({
  title,
  icon,
  badgeClassName,
  badgeValue,
  emptyMessage,
  columns,
  rows,
  onDownload,
  fileNameHint,
  reasonField,
  onReasonChange,
}) {
  const isHoldTable = icon.includes('pause')

  return (
    <section className="panel-card mb-4">
      <div className="panel-card-header">
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <span>
            <i className={`bi ${icon}`} /> {title}
          </span>
          <span className={`badge ${badgeClassName}`}>{badgeValue}</span>
          {fileNameHint ? <small className="text-secondary">{fileNameHint}</small> : null}
        </div>
        <button className="btn btn-sm btn-outline-secondary fw-semibold" onClick={onDownload}>
          <i className="bi bi-download me-1" />
          CSV
        </button>
      </div>
      <div className="panel-card-body p-0">
        {rows.length === 0 ? (
          <div className="empty-table">{emptyMessage}</div>
        ) : (
          <div className="table-scroll-sm">
            <table className="table table-hover table-bordered mb-0 data-table">
              <thead>
                <tr>
                  {columns.map(([label]) => (
                    <th key={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${title}-${row.serial || row.dsn || index}`} className={isHoldTable ? 'row-hold' : 'row-skip'}>
                    {columns.map(([label, key]) => (
                      <td key={`${label}-${key}`}>
                        <OrderCell
                          field={key}
                          value={row[key]}
                          holdTable={isHoldTable}
                          row={row}
                          reasonField={reasonField}
                          onReasonChange={onReasonChange}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

function OrderCell({ field, value, holdTable, row, reasonField, onReasonChange }) {
  const safeValue = value || '—'

  if (reasonField && field === reasonField) {
    return (
      <textarea
        className="form-control form-control-sm reason-input"
        rows="2"
        placeholder={`Enter ${holdTable ? 'hold' : 'skip'} reason`}
        value={value || ''}
        onChange={(event) => onReasonChange?.(row, event.target.value)}
      />
    )
  }

  if (field === 'variant') {
    return <span className="badge text-bg-secondary">{safeValue}</span>
  }
  if (field === 'model') {
    return <span className="badge text-bg-info text-dark">{safeValue}</span>
  }
  if (field === 'vehicle_type') {
    return <span className="badge text-bg-secondary">{safeValue}</span>
  }
  if (field === 'region') {
    return <span className="badge text-bg-dark">{safeValue}</span>
  }
  if (field === 'work_content' || field === 'dsn') {
    return <span className="fw-semibold">{safeValue}</span>
  }
  if (field === 'status') {
    return <span className="state-pill state-pill-skip">{safeValue}</span>
  }
  if (field === 'vehicle_order_state' && holdTable) {
    return <span className="state-pill state-pill-hold">HOLD</span>
  }
  if (field === 'hold_status') {
    return <span className="badge text-bg-warning">{safeValue}</span>
  }
  if (field === 'serial') {
    return <code>{safeValue}</code>
  }

  return <span>{safeValue}</span>
}

function App() {
  const fileInputId = useId()
  const shortageIntro =
    'Map variant Excel files and provide reference order plus quantity to trace shortage impact through the sequence.'
  const [selectedFile, setSelectedFile] = useState(null)
  const [dragActive, setDragActive] = useState(false)
  const [capacity, setCapacity] = useState('')
  const [startDate, setStartDate] = useState('')
  const [holidayInput, setHolidayInput] = useState('')
  const [holidays, setHolidays] = useState([])
  const [shortages, setShortages] = useState([createShortageRow()])
  const [analysis, setAnalysis] = useState(null)
  const [holdReasons, setHoldReasons] = useState({})
  const [skipReasons, setSkipReasons] = useState({})
  const [loading, setLoading] = useState(false)
  const [toasts, setToasts] = useState([])
  const resultsRef = useRef(null)
  const toastCounterRef = useRef(0)
  const enrichedAnalysis = enrichAnalysisWithReasons(analysis, holdReasons, skipReasons)

  const sequencedPreview = applySequence(
    enrichedAnalysis?.previewColumns ?? [],
    enrichedAnalysis?.previewData ?? [],
    capacity,
    startDate,
    holidays,
  )
  const deferredPreviewRows = useDeferredValue(sequencedPreview.rows)
  const inferenceCards = buildInference(sequencedPreview.rows, enrichedAnalysis?.summary?.shortage_parts ?? [])

  useEffect(() => {
    if (!analysis || !resultsRef.current) {
      return
    }
    resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [analysis])

  function pushToast(message, type = 'danger') {
    toastCounterRef.current += 1
    const id = `toast-${toastCounterRef.current}`
    setToasts((current) => [...current, { id, message, type }])
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id))
    }, 5000)
  }

  function dismissToast(id) {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }

  function updateShortage(id, patch) {
    setShortages((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    )
  }

  function addShortage() {
    setShortages((current) => [...current, createShortageRow()])
  }

  function removeShortage(id) {
    setShortages((current) => {
      if (current.length === 1) {
        return [createShortageRow()]
      }
      return current.filter((row) => row.id !== id)
    })
  }

  function addHoliday() {
    if (!holidayInput || holidays.includes(holidayInput)) {
      return
    }
    setHolidays((current) => [...current, holidayInput].sort())
    setHolidayInput('')
  }

  function removeHoliday(dateKey) {
    setHolidays((current) => current.filter((holiday) => holiday !== dateKey))
  }

  function resetAll() {
    setSelectedFile(null)
    setDragActive(false)
    setCapacity('')
    setStartDate('')
    setHolidayInput('')
    setHolidays([])
    setShortages([createShortageRow()])
    setAnalysis(null)
    setHoldReasons({})
    setSkipReasons({})
    setToasts([])
  }

  async function runAnalysis() {
    if (!selectedFile) {
      pushToast('Action blocked: please upload a main report file.', 'warning')
      return
    }

    setLoading(true)
    const formData = new FormData()
    formData.append('file', selectedFile)

    for (const shortage of shortages) {
      if (shortage.part.trim() && shortage.file) {
        formData.append('shortage_parts', shortage.part.trim())
        formData.append('shortage_refs', shortage.ref.trim())
        formData.append('shortage_qtys', shortage.qty.toString().trim())
        formData.append('shortage_files', shortage.file)
      }
    }

    try {
      const response = await fetch('/api/analyze', { method: 'POST', body: formData })
      const raw = await response.json()
      if (!response.ok || raw.error) {
        throw new Error(raw.error || 'Server returned an unexpected error.')
      }

      startTransition(() => {
        setAnalysis(normalizeData(raw))
        setHoldReasons({})
        setSkipReasons({})
      })
    } catch (error) {
      pushToast(`Network error: ${error.message}`, 'danger')
    } finally {
      setLoading(false)
    }
  }

  function downloadPreview() {
    if (!sequencedPreview.columns.length || !sequencedPreview.rows.length) {
      pushToast('No sequence data available to download.', 'warning')
      return
    }
    triggerDownload('Sequenced_Production_Report.csv', sequencedPreview.columns, sequencedPreview.rows)
  }

  function downloadHoldOrders() {
    if (!enrichedAnalysis?.holdOrders?.length) {
      pushToast('No hold orders available to download.', 'warning')
      return
    }
    triggerDownload('Hold_Orders.csv', HOLD_EXPORT_COLUMNS, enrichedAnalysis.holdOrders)
  }

  function downloadSkipOrders() {
    if (!enrichedAnalysis?.skipOrders?.length) {
      pushToast('No skip orders available to download.', 'warning')
      return
    }
    triggerDownload('Skip_Orders.csv', SKIP_EXPORT_COLUMNS, enrichedAnalysis.skipOrders)
  }

  function updateHoldReason(row, value) {
    const key = getVehicleKey(row, 'hold')
    console.info('Updated hold reason', { key, serial: row.serial, dsn: row.dsn, orderNumber: row.order_number, value })
    setHoldReasons((current) => ({ ...current, [key]: value }))
  }

  function updateSkipReason(row, value) {
    const key = getVehicleKey(row, 'skip')
    console.info('Updated skip reason', { key, serial: row.serial, dsn: row.dsn, orderNumber: row.order_number, value })
    setSkipReasons((current) => ({ ...current, [key]: value }))
  }

  const holdModelData = buildPieData(enrichedAnalysis?.summary?.hold_stratification, PIE_HOLD_COLORS)
  const skipModelData = buildPieData(enrichedAnalysis?.summary?.skip_stratification, PIE_SKIP_COLORS)
  const holdTypeData = [enrichedAnalysis?.summary?.hold_type_stratification?.Bus || 0, enrichedAnalysis?.summary?.hold_type_stratification?.Truck || 0]
  const skipTypeData = [enrichedAnalysis?.summary?.skip_type_stratification?.Bus || 0, enrichedAnalysis?.summary?.skip_type_stratification?.Truck || 0]
  const holdWcData = [enrichedAnalysis?.summary?.hold_wc_stratification?.HWC || 0, enrichedAnalysis?.summary?.hold_wc_stratification?.LWC || 0]
  const skipWcData = [enrichedAnalysis?.summary?.skip_wc_stratification?.HWC || 0, enrichedAnalysis?.summary?.skip_wc_stratification?.LWC || 0]
  const holdRegionData = [
    enrichedAnalysis?.summary?.hold_region_stratification?.Domestic || 0,
    enrichedAnalysis?.summary?.hold_region_stratification?.Export || 0,
  ]
  const skipRegionData = [
    enrichedAnalysis?.summary?.skip_region_stratification?.Domestic || 0,
    enrichedAnalysis?.summary?.skip_region_stratification?.Export || 0,
  ]

  return (
    <div className="app-shell">
      <Toasts items={toasts} onDismiss={dismissToast} />

      <header className="hero-bar">
        <div className="hero-symbol">
          <i className="bi bi-diagram-3-fill" />
        </div>
        <div>
          <p className="hero-kicker">Sequence intelligence workspace</p>
          <h1>Sequence &amp; Skip Order Analyzer</h1>
          <p className="hero-copy">
            React frontend with the existing Flask impact engine behind it. Upload the production report, layer in shortage
            mapping, and inspect the affected vehicles in one flow.
          </p>
        </div>
      </header>

      <main className="container-fluid px-3 px-xl-4 pb-5">
        <section className="row g-4 mt-1">
          <div className="col-xl-4">
            <div className="step-card h-100">
              <div className="step-header">
                <span>
                  <i className="bi bi-1-circle-fill" /> Step 1: Sequence config
                </span>
              </div>
              <div className="step-body">
                <label className="form-label fw-semibold small">Daily Capacity</label>
                <div className="input-group input-group-sm mb-3">
                  <span className="input-group-text">
                    <i className="bi bi-123" />
                  </span>
                  <input
                    type="number"
                    className="form-control"
                    min="1"
                    placeholder="Enter daily capacity"
                    value={capacity}
                    onChange={(event) => setCapacity(event.target.value)}
                  />
                </div>

                <label className="form-label fw-semibold small">Start Date</label>
                <div className="input-group input-group-sm mb-3">
                  <span className="input-group-text">
                    <i className="bi bi-calendar-date" />
                  </span>
                  <input
                    type="date"
                    className="form-control"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                </div>

                <label className="form-label fw-semibold small">Exclude Holidays</label>
                <div className="input-group input-group-sm">
                  <input
                    type="date"
                    className="form-control"
                    value={holidayInput}
                    onChange={(event) => setHolidayInput(event.target.value)}
                  />
                  <button className="btn btn-outline-secondary" type="button" onClick={addHoliday}>
                    <i className="bi bi-plus-lg" />
                  </button>
                </div>

                <div className="holiday-list">
                  {holidays.map((holiday) => (
                    <span key={holiday} className="badge holiday-chip">
                      {holiday}
                      <button type="button" className="chip-dismiss" onClick={() => removeHoliday(holiday)}>
                        <i className="bi bi-x-circle" />
                      </button>
                    </span>
                  ))}
                </div>

                <div className="config-note">
                  <span className={`status-pill status-pill-${sequencedPreview.statusTone}`}>
                    {sequencedPreview.statusLabel}
                  </span>
                  <span className="muted-kpi">
                    Takt time: <strong>{sequencedPreview.taktTime ? `${sequencedPreview.taktTime} min` : 'Pending'}</strong>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="col-xl-4">
            <div className="step-card h-100">
              <div className="step-header with-action">
                <span>
                  <i className="bi bi-2-circle-fill" /> Step 2: Part shortages
                </span>
                <button className="btn btn-sm btn-outline-primary" type="button" onClick={addShortage}>
                  <i className="bi bi-plus" /> Add Part
                </button>
              </div>
              <div className="step-body shortage-stack">
                <p className="step-copy">{shortageIntro}</p>
                {shortages.map((shortage) => (
                  <div key={shortage.id} className="shortage-card">
                    <div className="row g-2">
                      <div className="col-sm-6">
                        <label className="form-label small fw-semibold">Part No.</label>
                        <input
                          type="text"
                          className="form-control form-control-sm"
                          value={shortage.part}
                          onChange={(event) => updateShortage(shortage.id, { part: event.target.value })}
                        />
                      </div>
                      <div className="col-sm-6">
                        <label className="form-label small fw-semibold">Reference Order</label>
                        <input
                          type="text"
                          className="form-control form-control-sm"
                          value={shortage.ref}
                          onChange={(event) => updateShortage(shortage.id, { ref: event.target.value })}
                        />
                      </div>
                      <div className="col-sm-4">
                        <label className="form-label small fw-semibold">Qty</label>
                        <input
                          type="number"
                          min="0"
                          className="form-control form-control-sm"
                          value={shortage.qty}
                          onChange={(event) => updateShortage(shortage.id, { qty: event.target.value })}
                        />
                      </div>
                      <div className="col-sm-8">
                        <label className="form-label small fw-semibold">Variant File</label>
                        <input
                          type="file"
                          accept=".xlsx,.xls,.csv"
                          className="form-control form-control-sm"
                          onChange={(event) => updateShortage(shortage.id, { file: event.target.files?.[0] ?? null })}
                        />
                      </div>
                    </div>
                    <div className="shortage-card-footer">
                      <small className="text-secondary">{shortage.file?.name || 'No variant file selected yet'}</small>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger"
                        onClick={() => removeShortage(shortage.id)}
                      >
                        <i className="bi bi-x" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="col-xl-4">
            <div className="step-card h-100">
              <div className="step-header">
                <span>
                  <i className="bi bi-3-circle-fill" /> Step 3: Upload report
                </span>
              </div>
              <div className="step-body d-flex flex-column">
                <label
                  htmlFor={fileInputId}
                  className={`upload-zone ${dragActive ? 'drag-active' : ''}`}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setDragActive(true)
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={(event) => {
                    event.preventDefault()
                    setDragActive(false)
                    const file = event.dataTransfer.files?.[0]
                    if (file) {
                      setSelectedFile(file)
                    }
                  }}
                >
                  <i className="bi bi-file-earmark-spreadsheet upload-icon" />
                  <span className="upload-title">Drop the main sequence report here</span>
                  <span className="upload-copy">or click to browse `.xlsx`, `.xls`, or `.csv` files</span>
                  <strong className="upload-file">{selectedFile?.name || 'No file selected'}</strong>
                </label>
                <input
                  id={fileInputId}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="d-none"
                  onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                />

                <div className="action-row">
                  <button className="btn btn-outline-secondary btn-sm px-3" type="button" onClick={resetAll}>
                    Reset
                  </button>
                  <button className="btn btn-primary btn-sm px-4 fw-semibold" type="button" disabled={loading} onClick={runAnalysis}>
                    {loading ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" />
                        Analyzing
                      </>
                    ) : (
                      <>
                        <i className="bi bi-search me-1" />
                        Analyze
                      </>
                    )}
                  </button>
                </div>

                <div className="upload-hint">
                  Backend target: <code>/api/analyze</code>
                </div>
              </div>
            </div>
          </div>
        </section>

        {enrichedAnalysis ? (
          <div ref={resultsRef} className="results-shell">
            <section className="row g-3 mb-4 mt-1">
              <StatCard label="Total Hold Orders" value={enrichedAnalysis.summary.total_hold || 0} tone="hold" icon="bi-pause-circle" />
              <StatCard
                label="Total Skip Orders"
                value={enrichedAnalysis.summary.total_skipped || 0}
                tone="skip"
                icon="bi-fast-forward-circle"
              />
              <StatCard
                label="Rows in Report"
                value={enrichedAnalysis.summary.total_in_file || 0}
                tone="volume"
                icon="bi-table"
              />
            </section>

            <section className="row g-4 mb-4">
              <PieChartCard
                title="Stratification: Hold Orders (By Model)"
                icon="bi-pie-chart-fill text-danger"
                data={holdModelData}
                emptyMessage="No hold orders to stratify."
              />
              <PieChartCard
                title="Stratification: Skip Orders (By Model)"
                icon="bi-pie-chart-fill text-warning"
                data={skipModelData}
                emptyMessage="No skip orders to stratify."
              />
            </section>

            <section className="row g-3 mb-4">
              <BarChartCard
                title="Hold: Type"
                icon="bi-bar-chart-line-fill text-primary"
                labels={['Bus', 'Truck']}
                values={holdTypeData}
                colors={['#5f50cf', '#2ec4b6']}
                orders={enrichedAnalysis.holdOrders}
                categoryKey="vehicle_type"
              />
              <BarChartCard
                title="Hold: W/C"
                icon="bi-bar-chart-steps text-primary"
                labels={['HWC', 'LWC']}
                values={holdWcData}
                colors={['#ef476f', '#2a9d8f']}
                orders={enrichedAnalysis.holdOrders}
                categoryKey="work_content"
              />
              <BarChartCard
                title="Hold: Reg."
                icon="bi-globe-americas text-primary"
                labels={['Domestic', 'Export']}
                values={holdRegionData}
                colors={['#3c91e6', '#ffc145']}
                orders={enrichedAnalysis.holdOrders}
                categoryKey="region"
              />
              <BarChartCard
                title="Skip: Type"
                icon="bi-bar-chart-line-fill text-primary"
                labels={['Bus', 'Truck']}
                values={skipTypeData}
                colors={['#5f50cf', '#2ec4b6']}
                orders={enrichedAnalysis.skipOrders}
                categoryKey="vehicle_type"
              />
              <BarChartCard
                title="Skip: W/C"
                icon="bi-bar-chart-steps text-primary"
                labels={['HWC', 'LWC']}
                values={skipWcData}
                colors={['#ef476f', '#2a9d8f']}
                orders={enrichedAnalysis.skipOrders}
                categoryKey="work_content"
              />
              <BarChartCard
                title="Skip: Reg."
                icon="bi-globe-americas text-primary"
                labels={['Domestic', 'Export']}
                values={skipRegionData}
                colors={['#3c91e6', '#ffc145']}
                orders={enrichedAnalysis.skipOrders}
                categoryKey="region"
              />
            </section>

            <section className="panel-card mb-4">
              <div className="panel-card-header">
                <span>
                  <i className="bi bi-diagram-2-fill" /> Out-of-sequence anomaly blocks
                </span>
              </div>
              <div className="panel-card-body p-0">
                <div className="table-responsive">
                  <table className="table table-bordered table-hover mb-0 data-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Break After Serial</th>
                        <th>Resumes At Serial</th>
                        <th>Out-of-sequence Range</th>
                        <th>Total in Block</th>
                      </tr>
                    </thead>
                    <tbody>
                      {enrichedAnalysis.gaps.length > 0 ? (
                        enrichedAnalysis.gaps.map((gap, index) => (
                          <tr key={`${gap.from_dsn}-${gap.to_dsn}-${index}`} className="gap-row">
                            <td>{index + 1}</td>
                            <td>
                              <code>{gap.from_dsn || 'N/A'}</code>
                            </td>
                            <td>
                              <code>{gap.to_dsn || 'N/A'}</code>
                            </td>
                            <td>
                              <span className="text-danger fw-semibold">{gap.skipped_range || ''}</span>
                            </td>
                            <td>
                              <span className="badge text-bg-danger">{gap.skipped_count || 0}</span>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="5" className="text-center text-secondary py-4">
                            No out-of-sequence blocks found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <ResultsTable
              title="Skip Orders"
              icon="bi-fast-forward-circle text-warning"
              badgeClassName="bg-warning text-dark"
              badgeValue={enrichedAnalysis.skipOrders.length}
              emptyMessage="No skip orders found."
              columns={SKIP_TABLE_COLUMNS}
              rows={enrichedAnalysis.skipOrders}
              onDownload={downloadSkipOrders}
              fileNameHint="TRIM LINE vehicles trapped in out-of-sequence blocks"
              reasonField="skip_reason"
              onReasonChange={updateSkipReason}
            />

            <ResultsTable
              title="Hold Orders"
              icon="bi-pause-circle text-danger"
              badgeClassName="bg-danger"
              badgeValue={enrichedAnalysis.holdOrders.length}
              emptyMessage="No hold orders found."
              columns={HOLD_TABLE_COLUMNS}
              rows={enrichedAnalysis.holdOrders}
              onDownload={downloadHoldOrders}
              reasonField="hold_reason"
              onReasonChange={updateHoldReason}
            />

            <section className="panel-card mb-4">
              <div className="panel-card-header">
                <div className="d-flex gap-2 flex-wrap align-items-center">
                  <span>
                    <i className="bi bi-table text-primary" /> Data Preview
                  </span>
                  <small className="text-secondary">Showing all rows</small>
                </div>
                <div className="d-flex gap-2 align-items-center flex-wrap">
                  <button className="btn btn-sm btn-outline-primary fw-semibold" onClick={downloadPreview}>
                    <i className="bi bi-download me-1" />
                    Download CSV
                  </button>
                  <span className={`status-pill status-pill-${sequencedPreview.statusTone}`}>{sequencedPreview.statusLabel}</span>
                </div>
              </div>
              <div className="panel-card-body p-0">
                <div className="preview-table-wrap">
                  <table className="table table-bordered table-hover mb-0 data-table preview-table">
                    <thead>
                      <tr>
                        {sequencedPreview.columns.map((column) => (
                          <th
                            key={column}
                            className={
                              ['Line in sequence', 'Production Date', 'Line in time'].includes(column) ? 'sequence-head' : ''
                            }
                          >
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {deferredPreviewRows.map((row, rowIndex) => {
                        const shortageCount = getShortageCount(row)
                        return (
                          <tr key={`preview-${rowIndex}-${row['Serial Number'] || row.Serial || rowIndex}`} className={getPreviewRowClass(shortageCount)}>
                            {sequencedPreview.columns.map((column) => {
                              const value = row[column] ?? ''
                              const className = getTableCellClass(column, value, shortageCount)
                              return (
                                <td key={`${column}-${rowIndex}`} className={className}>
                                  {String(value)}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            {inferenceCards.length > 0 ? (
              <section className="mb-4">
                <h5 className="section-title">
                  <i className="bi bi-exclamation-triangle-fill text-danger me-2" />
                  Shortage impact analysis
                </h5>
                <div className="row g-3">
                  {inferenceCards.map((card) => (
                    <div key={card.part} className="col-lg-6">
                      <div className={`inference-card ${card.covered ? 'inference-covered' : ''}`}>
                        <h6>{card.part}</h6>
                        {card.covered ? (
                          <p className="text-success fw-semibold mb-0">
                            <i className="bi bi-check-circle-fill me-1" />
                            Stock completely covers the current production sequence.
                          </p>
                        ) : (
                          <>
                            <div className="inference-grid">
                              <div>
                                <span className="detail-label">First Shortage Date</span>
                                <strong>{card.shortageDate}</strong>
                              </div>
                              <div>
                                <span className="detail-label">Sequence Numbers</span>
                                <strong>{card.firstDaySequences}</strong>
                              </div>
                              <div className="full-span">
                                <span className="detail-label">Connecting Models</span>
                                <strong>{card.connectingModels}</strong>
                              </div>
                            </div>

                            <span className="detail-label mb-2 d-inline-block">Day-wise requirements (next 4 production days)</span>
                            <table className="table table-sm table-bordered mb-0 inference-table">
                              <thead>
                                <tr>
                                  <th>Date</th>
                                  <th className="text-end">Day Plan</th>
                                  <th className="text-end">Shortage Qty</th>
                                </tr>
                              </thead>
                              <tbody>
                                {card.unscheduled ? (
                                  <tr>
                                    <td colSpan="3" className="text-center text-secondary py-3">
                                      Impacted vehicles are on hold or not scheduled.
                                    </td>
                                  </tr>
                                ) : (
                                  card.forecast.map((entry) => (
                                    <tr key={`${card.part}-${entry.date}`}>
                                      <td>{entry.date}</td>
                                      <td className="text-end fw-semibold">{entry.dayPlan}</td>
                                      <td className="text-end fw-semibold text-danger">{entry.shortageQty}</td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
      </main>
    </div>
  )
}

export default App

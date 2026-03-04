type ImportStoryInput = {
  sourceUrl: string
}

export async function importGoogleDocAsMarkdown(input: ImportStoryInput) {
  const exportUrl = normalizeGoogleDocExportUrl(input.sourceUrl)
  const response = await fetch(exportUrl)

  if (!response.ok) {
    throw new Error(`Failed to import Google Doc markdown: ${response.status}`)
  }

  const markdown = await response.text()
  const title = markdown.split('\n').find((line) => line.trim().startsWith('# '))?.replace('# ', '') ?? 'Imported Story'

  return {
    title,
    markdown,
    sourceDocUrl: input.sourceUrl,
  }
}

function normalizeGoogleDocExportUrl(url: string) {
  if (url.includes('/export?format=md')) {
    return url
  }

  const match = url.match(/\/document\/d\/([^/]+)/)
  if (!match) {
    throw new Error('Invalid Google Docs URL')
  }

  const docId = match[1]
  return `https://docs.google.com/document/d/${docId}/export?format=md`
}

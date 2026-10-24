/** Saves `blob` as `<name>.<extension>` (name made filesystem-safe); returns the filename. */
export function download(name, extension, blob) {
  const filename = `${name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'saved-list'}.${extension}`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return filename
}

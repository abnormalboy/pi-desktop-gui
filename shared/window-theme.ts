/** These colors match --bg, --rail and --ink in src/styles/base.css. */
export function windowTheme(dark: boolean) {
  return dark
    ? { background: '#121816', color: '#141b18', symbolColor: '#e4ebe8', height: 36 }
    : { background: '#ffffff', color: '#f5f7f6', symbolColor: '#18221f', height: 36 };
}

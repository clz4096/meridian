/** The build-time catalog index (scripts/cambridge/index-plugin.mjs). */
declare module 'virtual:cambridge-index' {
  const data: import('@/features/cambridge/catalogBuild').CatalogIndexData;
  export default data;
}

/** One built catalog track: step, courses or cst (scripts/cambridge/index-plugin.mjs). */
declare module 'virtual:cambridge-track/*' {
  const data: import('@/features/cambridge/catalogBuild').CatTrackData;
  export default data;
}

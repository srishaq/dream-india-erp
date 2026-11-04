// Bundled at build time into public/cad/viewer.js (scripts/build-cad.js): the open-source mlightcad CAD viewer
// (MIT) with the LibreDWG reader (GPL, kept in its own worker file). Drawings are read in the browser.
import { AcApDocManager } from '@mlightcad/cad-simple-viewer';
import { AcDbDatabaseConverterManager, AcDbFileType } from '@mlightcad/data-model';
import { AcDbLibreDwgConverter } from '@mlightcad/libredwg-converter';
window.ERPCad = {
  AcApDocManager,
  useDwgWorker(url) { AcDbDatabaseConverterManager.instance.register(AcDbFileType.DWG, new AcDbLibreDwgConverter({ useWorker: true, parserWorkerUrl: url })); },
};

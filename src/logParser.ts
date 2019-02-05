import * as xml2js from "xml2js";
import { xml2jsParseSettings } from "./common/constants";
import { ISvnLogEntry } from "./common/types";

export async function parseSvnLog(content: string): Promise<ISvnLogEntry[]> {
  return new Promise<ISvnLogEntry[]>((resolve, reject) => {
    xml2js.parseString(content, xml2jsParseSettings, (err, result) => {
      if (err) {
        reject();
      }
      let transformed = [];
      if (Array.isArray(result.logentry)) {
        transformed = result.logentry;
      } else if (typeof result.logentry === "object") {
        transformed = [result.logentry];
      }
      const allEntries = [];
      for (const logentry of transformed) {
        allEntries.push(logentry);
        // merge info
        if (logentry.logentry) {
          let subentries = logentry.logentry;
          delete logentry.logentry;
          if (!Array.isArray(subentries)) {
            subentries = [subentries];
          }
          subentries.forEach((element: ISvnLogEntry) => {
            element.fromMerge = true;
          });
          allEntries.push(... subentries);
        }
      }
      for (const logentry of allEntries) {
        if (logentry.paths === undefined) {
          logentry.paths = [];
        } else if (Array.isArray(logentry.paths.path)) {
          logentry.paths = logentry.paths.path;
        } else {
          logentry.paths = [logentry.paths.path];
        }
      }
      resolve(allEntries);
    });
  });
}

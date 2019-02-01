import * as xml2js from "xml2js";
import { xml2jsParseSettings } from "./common/constants";
import { ISvnBlameEntry } from "./common/types";

export async function parseSvnBlame(content: string): Promise<ISvnBlameEntry[]> {
  return new Promise<ISvnBlameEntry[]>((resolve, reject) => {
    xml2js.parseString(content, xml2jsParseSettings, (err, result) => {
      if (err) {
        reject(err);
      }
      let transformed = [];
      if (Array.isArray(result.target)) {
        transformed = result.target;
      } else if (typeof result.target === "object") {
        transformed = [result.target];
      }
      resolve(transformed.map((e: any): ISvnBlameEntry => {
        return {
          author: e.author,
          date: new Date(e.date),
          line_number: parseInt(e.line_number, 10),
          revision: e.revision
        };
      }));
    });
  });
}

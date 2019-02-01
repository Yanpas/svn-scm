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
      if (Array.isArray(result.target.entry)) {
        transformed = result.target.entry;
      } else if (typeof result.target.entry === "object") {
        transformed = [result.target.entry];
      }
      resolve(transformed.map((e: any): ISvnBlameEntry => {
        return {
          author: e.commit.author,
          date: new Date(e.commit.date),
          lineNumber: parseInt(e.lineNumber, 10),
          revision: e.commit.revision
        };
      }));
    });
  });
}

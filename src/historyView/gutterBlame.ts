import { Range, TextEditor, ThemeColor, Uri, window } from "vscode";
import { ISvnBlameEntry, ISvnCommit } from "../common/types";
import { Model } from "../model";
import { ResourceKind } from "../pathNormalizer";
import { Repository } from "../repository";
import { getCommitIcon } from "./common";

export function blameCurrentFile(model: Model) {
  if (!window.activeTextEditor) {
    return;
  }

  const uri = window.activeTextEditor.document.uri;
  const repo = model.getRepository(uri);
  if (!repo) {
    window.showWarningMessage("This file doesn't belong to any svn repository");
    return;
  }

  const gutter = new GutterBlame(uri, repo, window.activeTextEditor);
  gutter.decorate();
}

interface IBlameRange {
  lineStart: number;
  lineEnd: number;
  commit?: {
    author: string;
    date: Date;
    revision: number;
  };
}

function transformBlames(input: ISvnBlameEntry[]): IBlameRange[] {
  if (input.length === 0) {
    return [];
  }
  const mergedBlames: IBlameRange[] = [];
  let lastBlame = input[0];
  let lineStart = 0;
  const convert = (e: ISvnBlameEntry) => {
    const lineEnd = parseInt(e.lineNumber, 10);
    let commit;
    if (e.commit) {
      commit = {
        author: e.commit.author,
        date: new Date(e.commit.date),
        revision: parseInt(e.commit.revision, 10)
      };
    }
    return {
      lineStart,
      lineEnd,
      commit
    };
  };
  for (const blame of input) {
    if (!(
         (!lastBlame.commit && !blame.commit) ||
         (!!lastBlame.commit && !!blame.commit &&
            lastBlame.commit!.revision === blame.commit!.revision))
        ) {
      mergedBlames.push(convert(lastBlame));
      lineStart = mergedBlames[mergedBlames.length - 1].lineEnd;
    }
    lastBlame = blame;
  }
  mergedBlames.push(convert(lastBlame));
  return mergedBlames;
}

function commitRange(range: IBlameRange[]): [number, number] {
  let rmin = -1;
  let rmax = -1;
  for (const blame of range) {
    if (blame.commit) {
      if (blame.commit.revision < rmin || rmin === -1) {
        rmin = blame.commit.revision;
      }
      if (blame.commit.revision > rmax || rmax === -1) {
        rmax = blame.commit.revision;
      }
    }
  }
  return [rmin, rmax];
}

async function getRevisionMessages(
  repo: Repository,
  rmin: number,
  rmax: number,
  target: Uri
  ): Promise<Map<number, string>> {
  if (rmin === -1 && rmax === -1) {
    return new Map();
  }
  const res = new Map<number, string>();
  const logentries = await repo.log(rmin.toString(), rmax.toString(), undefined, target.fsPath);
  for (const le of logentries) {
    res.set(parseInt(le.revision, 10), le.msg);
  }
  return res;
}

export class GutterBlame {
  constructor(
    private fileUri: Uri,
    private repo: Repository,
    private editor: TextEditor
  ) {}

  public async decorate() {
    const svnri = this.repo.getPathNormalizer().parse(
      this.fileUri.fsPath, ResourceKind.LocalFull);
    const svnBlames = await this.repo.blame(svnri);
    if (svnBlames.length === 0) {
      return;
    }

    const blames = transformBlames(svnBlames);

    const [rmin, rmax] = commitRange(blames);
    const msgs = await getRevisionMessages(this.repo, rmin, rmax, this.fileUri);

    for (const blame of blames) {
      for (let ln = blame.lineStart; ln < blame.lineEnd; ++ln) {
        let message = "";
        let icon;
        if (ln === blame.lineStart) {
          if (blame.commit) {
            message = msgs.get(blame.commit.revision) || `Revision ${blame.commit.revision}`;
            icon = getCommitIcon(blame.commit!.author) as Uri; // TODO
          } else {
            message = "Uncommited changes";
          }
        }
        const decorations = window.createTextEditorDecorationType({
          gutterIconPath: icon,
          before: {
            contentText: message,
            backgroundColor: new ThemeColor("button.background"),
            height: "100%",
            margin: "0 26px -1px 0",
            width: "200px"
          },
          backgroundColor: new ThemeColor("gitlens.gutterBackgroundColor"),
          // borderStyle: "solid",
          borderWidth: "0 2px 0 0",
          color: new ThemeColor("gitlens.gutterForegroundColor"),
          fontWeight: "normal",
          fontStyle: "normal",
          // height: "100%",
          // margin: `0 26px -1px 0`,
          textDecoration: "overline solid rgba(0, 0, 0, .2)",
          // width: "26",
          // uncommittedColor: new ThemeColor('gitlens.gutterUncommittedForegroundColor')
        });
        this.editor.setDecorations(decorations, [new Range(ln, 0, ln, 0)]);
      }
    }
  }
}

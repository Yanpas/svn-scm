import { Disposable, Range, TextEditor, TextEditorDecorationType, ThemeColor, Uri, window } from "vscode";
import { ISvnBlameEntry, ISvnCommit } from "../common/types";
import { Model } from "../model";
import { ResourceKind } from "../pathNormalizer";
import { Repository } from "../repository";
import { getGravatarIcon } from "./common";

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

export class GutterBlame implements Disposable {
  private msgs = new Map<number, string>();
  private blames = new Array<IBlameRange>();
  private selectionDecorations = new Array<TextEditorDecorationType>();

  constructor(
    private fileUri: Uri,
    private repo: Repository,
    private editor: TextEditor
  ) {}

  public dispose() {
    this.selectionDecorations.forEach(e => e.dispose());
  }

  private getGutterDecoration(isFirstLine: boolean, blame: IBlameRange) {
    let message = "";
    let icon;
    if (isFirstLine) {
      if (blame.commit) {
        message = this.msgs.get(blame.commit.revision) || `Revision ${blame.commit.revision}`;
        icon = getGravatarIcon(blame.commit.author);
      } else {
        message = "Uncommited changes";
        // TODO add some icon
      }
    }
    return window.createTextEditorDecorationType({
      gutterIconPath: icon,
      before: {
        contentText: message,
        backgroundColor: new ThemeColor("editor.selectionHighlightBackground"),
        height: "100%",
        margin: "0 26px -1px 0",
        width: "200px",
        textDecoration: "overline solid rgba(0, 0, 0, .2)",
        fontStyle: "none",
      },
      borderWidth: "0 2px 0 0",
      fontWeight: "none",
      fontStyle: "none",
      textDecoration: "overline solid rgba(0, 0, 0, .2)",
    });
  }

  private getSelectionDecoration(): Array<[TextEditorDecorationType, number]> {
    const res: Array<[TextEditorDecorationType, number]> = [];

    const activeLine = this.editor.selection.active.line;
    let revision;
    for (const blame of this.blames) {
      // TODO binray search ?
      if (activeLine >= blame.lineStart && activeLine < blame.lineEnd) {
        revision = blame.commit ? blame.commit.revision : undefined;
        break;
      }
    }

    for (const blame of this.blames) {
      if ((!revision && !blame.commit) ||
          blame.commit && blame.commit!.revision === revision!) {
        for (let i = blame.lineStart; i < blame.lineEnd; ++i) {
          const dec = window.createTextEditorDecorationType({
            backgroundColor: "rgba(0,50,120,15)",
            isWholeLine: true,
          });
          res.push([dec, i]);
        }
      }
    }

    return res;
  }

  public onSelectionChanged() {
    this.selectionDecorations.forEach(e => e.dispose());
    this.selectionDecorations = [];
    for (const [decor, ln] of this.getSelectionDecoration()) {
      this.editor.setDecorations(decor, [new Range(ln, 0, ln, 0)]);
      this.selectionDecorations.push(decor);
    }
  }

  public async decorate() {
    const svnri = this.repo.getPathNormalizer().parse(
      this.fileUri.fsPath, ResourceKind.LocalFull);

    if (this.blames.length === 0) {
      // init fielfds of class
      let svnBlames;
      try {
        svnBlames = await this.repo.blame(svnri);
      } catch (e) {
        window.showErrorMessage("Failed to get blame for this file");
        console.error(`blame: ${e.message}`);
        return;
      }
      if (svnBlames.length === 0) {
        return;
      }

      this.blames = transformBlames(svnBlames);
      const [rmin, rmax] = commitRange(this.blames);
      this.msgs = await getRevisionMessages(this.repo, rmin, rmax, this.fileUri);

      window.onDidChangeTextEditorSelection(this.onSelectionChanged, this, undefined); // todo
    }

    for (const blame of this.blames) {
      for (let ln = blame.lineStart; ln < blame.lineEnd; ++ln) {
        const decor = this.getGutterDecoration(ln === blame.lineStart, blame);
        this.editor.setDecorations(decor, [new Range(ln, 0, ln, 0)]);
      }
    }

    this.onSelectionChanged();
  }
}

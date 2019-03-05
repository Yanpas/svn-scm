import { distanceInWordsToNow } from "date-fns";
import {
  Disposable,
  MarkdownString,
  Range,
  TextEditor,
  TextEditorDecorationType,
  ThemeColor,
  Uri,
  window
} from "vscode";
import { ISvnBlameEntry } from "../common/types";
import { configuration } from "../helpers/configuration";
import { Model } from "../model";
import { ResourceKind } from "../pathNormalizer";
import { Repository } from "../repository";
import { SvnRI } from "../svnRI";
import { getGravatarIcon } from "./common";

let prevGutter: GutterBlame | undefined;
let editorChanged: Disposable | undefined;

export function blameCurrentFile(model: Model) {
  if (!editorChanged) {
    editorChanged = window.onDidChangeActiveTextEditor(() => {
      if (prevGutter) {
        prevGutter.dispose();
        prevGutter = undefined;
      }
    });
  }
  if (!window.activeTextEditor) {
    return;
  }

  const uri = window.activeTextEditor.document.uri;
  const repo = model.getRepository(uri);
  if (!repo) {
    window.showWarningMessage("This file doesn't belong to any svn repository");
    return;
  }

  if (prevGutter) {
    prevGutter.dispose();
  }
  prevGutter = new GutterBlame(uri, repo, window.activeTextEditor);
  prevGutter.decorate();
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
    if (
      !(
        (!lastBlame.commit && !blame.commit) ||
        (!!lastBlame.commit &&
          !!blame.commit &&
          lastBlame.commit!.revision === blame.commit!.revision)
      )
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
  target: SvnRI,
  isLocal: boolean
): Promise<Map<number, string>> {
  if (rmin === -1 && rmax === -1) {
    return new Map();
  }
  const res = new Map<number, string>();
  const logentries = await repo.log(
    rmin.toString(),
    rmax.toString(),
    configuration.get<boolean>("blame.useMergeInfo", true),
    undefined,
    {
      isLocal,
      path: target.toString(false),
      rscKind: ResourceKind.RemoteFull
    }
  );
  for (const le of logentries) {
    res.set(parseInt(le.revision, 10), le.msg);
  }
  return res;
}

export class GutterBlame implements Disposable {
  private msgs = new Map<number, string>();
  private blames = new Array<IBlameRange>();
  private textDecorations = new Array<Disposable>();
  private selectionDecorations = new Array<Disposable>();
  private selectionEvent?: Disposable;

  constructor(
    private fileUri: Uri,
    private repo: Repository,
    private editor: TextEditor
  ) {}

  public dispose() {
    this.textDecorations.forEach(e => e.dispose());
    this.selectionDecorations.forEach(e => e.dispose());
    if (this.selectionEvent) {
      this.selectionEvent.dispose();
    }
  }

  private getGutterDecoration(
    isFirstLine: boolean,
    blame: IBlameRange
  ): [TextEditorDecorationType, MarkdownString] {
    let message = "";
    let revision = "";
    let icon;
    if (blame.commit) {
      message =
        this.msgs.get(blame.commit.revision) ||
        `Revision ${blame.commit.revision}`;
      if (isFirstLine) {
        icon = getGravatarIcon(blame.commit.author);
      }
      revision = `r${blame.commit.revision}`;
    } else {
      message = "Uncommited changes";
      revision = "Working copy";
      // TODO add some icon
    }
    let contentText = " ".repeat(60);
    if (isFirstLine) {
      const distS = blame.commit ? distanceInWordsToNow(blame.commit.date) : "";
      const distSS = distS.substr(0, 25);
      const messageSS = message.substr(0, 30);
      contentText =
        messageSS +
        "\xa0".repeat(60 - messageSS.length - distSS.length) +
        distSS;
    }
    const decor = window.createTextEditorDecorationType({
      gutterIconPath: icon,
      before: {
        contentText,
        backgroundColor: new ThemeColor("editor.selectionHighlightBackground"),
        height: "100%",
        margin: "0 26px -1px 0",
        width: "60ch",
        textDecoration: "overline solid rgba(0, 0, 0, .2)",
        fontStyle: "none"
      },
      borderWidth: "0 2px 0 0",
      fontWeight: "none",
      fontStyle: "none",
      textDecoration: "overline solid rgba(0, 0, 0, .2)"
    });
    const mdlines = [message, revision];
    if (blame.commit) {
      mdlines.push(`Author: ${blame.commit.author}`);
      mdlines.push(`Date: ${blame.commit.date}`);
    }
    return [decor, new MarkdownString(mdlines.join("\n\n"))];
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
      if (
        (!revision && !blame.commit) ||
        (blame.commit && blame.commit!.revision === revision!)
      ) {
        for (let i = blame.lineStart; i < blame.lineEnd; ++i) {
          const dec = window.createTextEditorDecorationType({
            backgroundColor: "rgba(0,50,120,15)",
            isWholeLine: true
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
    const svnri = this.repo
      .getPathNormalizer()
      .parse(this.fileUri.fsPath, ResourceKind.LocalFull);

    if (this.blames.length === 0) {
      // init fielfds of class
      let svnBlames;
      try {
        svnBlames = await this.repo.blame(svnri, true);
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
      this.msgs = await getRevisionMessages(this.repo, rmin, rmax, svnri, true);

      if (this.selectionEvent) {
        this.selectionEvent.dispose();
      }
      this.selectionEvent = window.onDidChangeTextEditorSelection(
        this.onSelectionChanged,
        this,
        undefined
      );
    }

    for (const blame of this.blames) {
      // TODO research performance, separate decoration on each line is heavy?
      for (let ln = blame.lineStart; ln < blame.lineEnd; ++ln) {
        const [decor, md] = this.getGutterDecoration(
          ln === blame.lineStart,
          blame
        );
        this.textDecorations.push(decor);
        this.editor.setDecorations(decor, [
          {
            range: new Range(ln, 0, ln, 0),
            hoverMessage: md
          }
        ]);
      }
    }

    this.onSelectionChanged();
  }
}

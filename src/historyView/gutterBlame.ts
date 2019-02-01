import { TextEditor, Uri, window, Range } from "vscode";
import { Model } from "../model";
import { ResourceKind } from "../pathNormalizer";
import { Repository } from "../repository";
import { getCommitIcon } from "./common";
import { ISvnBlameEntry } from "../common/types";

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

export class GutterBlame {
  constructor(
    private fileUri: Uri,
    private repo: Repository,
    private editor: TextEditor
  ) {}

  public async decorate() {
    const svnri = this.repo.getPathNormalizer().parse(
      this.fileUri.fsPath, ResourceKind.LocalFull);
    const blames = await this.repo.blame("0", "BASE", svnri);
    if (blames.length === 0) {
      return;
    }

    const mergedBlames: ISvnBlameEntry[] = [];
    let lastBlame = blames[0];
    for (const blame of blames) {
      if (lastBlame.revision !== blame.revision) {
        mergedBlames.push(lastBlame);
      }
      lastBlame = blame;
    }
    mergedBlames.push(lastBlame);

    let startLine = 0;
    for (const blame of mergedBlames) {
      const decorations = window.createTextEditorDecorationType({
        gutterIconPath: getCommitIcon(blame.revision) as Uri, // TODO
      });
      this.editor.setDecorations(decorations, [new Range(startLine, 0, blame.lineNumber - 1, 0)]);
      startLine = blame.lineNumber;
    }
  }
}

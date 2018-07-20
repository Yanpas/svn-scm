import * as path from "path";
import { TreeItem, TreeDataProvider, TreeItemCollapsibleState } from "vscode";
import BaseNode from "./baseNode";
import { getIconUri } from "../../uri";

export default class RepositoryNode implements TreeDataProvider<BaseNode> {
  constructor(private _label: string) {}

  get label() {
    return path.basename(this._label);
  }

  public getTreeItem(): TreeItem {
    const item = new TreeItem(this.label, TreeItemCollapsibleState.Collapsed);
    item.iconPath = {
      dark: getIconUri("repo", "dark"),
      light: getIconUri("repo", "light")
    };

    return item;
  }

  public getChildren(): Thenable<BaseNode[]> {
    return Promise.resolve([]);
  }
}

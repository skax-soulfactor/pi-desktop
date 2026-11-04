import { contextBridge, ipcRenderer } from "electron";
import { createAgentApi } from "./api";

contextBridge.exposeInMainWorld("piAgent", createAgentApi(ipcRenderer));

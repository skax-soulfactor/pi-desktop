import { contextBridge, ipcRenderer } from "electron";
import { createMateApi } from "./api";

contextBridge.exposeInMainWorld("mate", createMateApi(ipcRenderer));

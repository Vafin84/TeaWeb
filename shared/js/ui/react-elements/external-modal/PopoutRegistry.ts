import {AbstractModal} from "../../../ui/react-elements/ModalDefinitions";

export interface PopoutHandler {
    name: string;
    loadClass: <T extends AbstractModal>() => Promise<any>;
}

const registeredHandler: {[key: string]: PopoutHandler} = {};

export function findPopoutHandler(name: string) {
    return registeredHandler[name];
}

function registerHandler(handler: PopoutHandler) {
    registeredHandler[handler.name] = handler;
}

registerHandler({
    name: "video-viewer",
    loadClass: async () => await import("tc-shared/video-viewer/Renderer")
});


registerHandler({
    name: "conversation",
    loadClass: async () => await import("../../frames/side/PopoutConversationRenderer")
});


registerHandler({
    name: "css-editor",
    loadClass: async () => await import("tc-shared/ui/modal/css-editor/Renderer")
});

registerHandler({
    name: "channel-tree",
    loadClass: async () => await import("tc-shared/ui/tree/popout/RendererModal")
});

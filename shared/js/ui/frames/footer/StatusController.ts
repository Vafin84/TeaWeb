import {ConnectionHandler, ConnectionState} from "tc-shared/ConnectionHandler";
import {ConnectionComponent, ConnectionStatus, ConnectionStatusEvents} from "./StatusDefinitions";
import {Registry} from "tc-shared/events";
import {VoiceConnectionStatus} from "tc-shared/connection/VoiceConnection";
import {VideoConnectionStatus} from "tc-shared/connection/VideoConnection";
import {LogCategory, logError} from "tc-shared/log";
import {tr} from "tc-shared/i18n/localize";

enum StatusNotifyState {
    /* no notify has been scheduled */
    UNSET,
    /* a notify is executing right now */
    EXECUTING,
    /* a notify has been scheduled after the currently notify has been completed */
    PENDING
}

export class StatusController {
    private readonly events: Registry<ConnectionStatusEvents>;

    private currentConnectionHandler: ConnectionHandler;
    private listenerHandler: (() => void)[];

    private detailedInfoOpen = false;
    private detailUpdateTimer: number;

    private componentStatusNotifyState: {[T in ConnectionComponent]: StatusNotifyState} = {
        voice: StatusNotifyState.UNSET,
        signaling: StatusNotifyState.UNSET,
        video: StatusNotifyState.UNSET
    };
    private connectionStatusNotifyState: StatusNotifyState = StatusNotifyState.UNSET;

    constructor(events: Registry<ConnectionStatusEvents>) {
        this.events = events;

        this.events.on("query_component_detail_state", () => this.events.fire_react("notify_component_detail_state", { shown: this.detailedInfoOpen }));
        this.events.on("query_component_status", event => this.notifyComponentStatus(event.component));
        this.events.on("query_connection_status", () => this.notifyConnectionStatus());

        this.events.on("action_toggle_component_detail", event => this.setDetailsShown(typeof event.shown === "boolean" ? event.shown : !this.detailedInfoOpen));
    }

    getEvents() : Registry<ConnectionStatusEvents> {
        return this.events;
    }

    setConnectionHandler(handler: ConnectionHandler | undefined) {
        if(this.currentConnectionHandler === handler) { return; }

        this.unregisterHandlerEvents();
        this.currentConnectionHandler = handler;
        this.registerHandlerEvents(handler);

        this.notifyConnectionStatus();
    }

    setDetailsShown(flag: boolean) {
        if(this.detailedInfoOpen === flag) { return; }

        this.detailedInfoOpen = flag;
        this.events.fire_react("notify_component_detail_state", { shown: this.detailedInfoOpen });

        if(this.detailedInfoOpen) {
            this.detailUpdateTimer = setInterval(() => {
                this.notifyComponentStatus("video");
                this.notifyComponentStatus("signaling");
                this.notifyComponentStatus("voice");
            }, 1000);
        } else {
            clearInterval(this.detailUpdateTimer);
        }
    }

    private registerHandlerEvents(handler: ConnectionHandler) {
        this.unregisterHandlerEvents();

        const events = this.listenerHandler = [];
        events.push(handler.events().on("notify_connection_state_changed", () => {
            this.notifyConnectionStatus();
            if(this.detailedInfoOpen) {
                this.notifyComponentStatus("signaling");
            }
        }));

        events.push(handler.getServerConnection().getVoiceConnection().events.on("notify_connection_status_changed", () => {
            this.notifyConnectionStatus();
            if(this.detailedInfoOpen) {
                this.notifyComponentStatus("voice");
            }
        }));

        events.push(handler.getServerConnection().getVideoConnection().getEvents().on("notify_status_changed", () => {
            this.notifyConnectionStatus();
            if(this.detailedInfoOpen) {
                this.notifyComponentStatus("video");
            }
        }));
    }

    private unregisterHandlerEvents() {
        this.listenerHandler?.forEach(callback => callback());
    }

    private async getComponentStatus(component: ConnectionComponent, detailed: boolean) : Promise<ConnectionStatus> {
        if(!this.currentConnectionHandler) {
            return { type: "disconnected" };
        }

        switch (component) {
            case "video":
                const videoConnection = this.currentConnectionHandler.getServerConnection().getVideoConnection();
                switch (videoConnection.getStatus()) {
                    case VideoConnectionStatus.Failed:
                        return { type: "unhealthy", reason: videoConnection.getFailedMessage(), retryTimestamp: videoConnection.getRetryTimestamp() };
                    case VideoConnectionStatus.Connected:
                        if(detailed) {
                            const statistics = await videoConnection.getConnectionStats();
                            return {
                                type: "healthy",
                                bytesSend: statistics.bytesSend,
                                bytesReceived: statistics.bytesReceived
                            };
                        } else {
                            return {
                                type: "healthy"
                            };
                        }

                    case VideoConnectionStatus.Disconnected:
                        return {
                            type: "disconnected"
                        };

                    case VideoConnectionStatus.Connecting:
                        return { type: "connecting-video" };

                    case VideoConnectionStatus.Unsupported:
                        return { type: "unsupported", side: "server" };
                }
                break;

            case "voice":
                const voiceConnection = this.currentConnectionHandler.getServerConnection().getVoiceConnection();
                switch (voiceConnection.getConnectionState()) {
                    case VoiceConnectionStatus.Failed:
                        return { type: "unhealthy", reason: voiceConnection.getFailedMessage(), retryTimestamp: voiceConnection.getRetryTimestamp() };

                    case VoiceConnectionStatus.Connected:
                        if(detailed) {
                            const statistics = await voiceConnection.getConnectionStats();
                            return {
                                type: "healthy",
                                bytesSend: statistics.bytesSend,
                                bytesReceived: statistics.bytesReceived
                            };
                        } else {
                            return {
                                type: "healthy"
                            };
                        }

                    case VoiceConnectionStatus.Disconnecting:
                    case VoiceConnectionStatus.Disconnected:
                        return { type: "disconnected" };

                    case VoiceConnectionStatus.Connecting:
                        return { type: "connecting-voice" };

                    case VoiceConnectionStatus.ServerUnsupported:
                        return { type: "unsupported", side: "server" };

                    case VoiceConnectionStatus.ClientUnsupported:
                        return { type: "unsupported", side: "client" };
                }
                break;

            case "signaling":
                switch (this.currentConnectionHandler.connection_state) {
                    case ConnectionState.INITIALISING:
                        return { type: "connecting-signalling", state: "initializing" };
                    case ConnectionState.CONNECTING:
                        return { type: "connecting-signalling", state: "connecting" };
                    case ConnectionState.AUTHENTICATING:
                        return { type: "connecting-signalling", state: "authentication" };
                    case ConnectionState.CONNECTED:
                        if(detailed) {
                            const statistics = this.currentConnectionHandler.getServerConnection().getControlStatistics();
                            return {
                                type: "healthy",
                                bytesSend: statistics.bytesSend,
                                bytesReceived: statistics.bytesReceived
                            };
                        } else {
                            return {
                                type: "healthy"
                            };
                        }
                    case ConnectionState.UNCONNECTED:
                    case ConnectionState.DISCONNECTING:
                        return { type: "disconnected" };
                }
                break;
        }
    }

    async notifyComponentStatus(component: ConnectionComponent) {
        switch (this.componentStatusNotifyState[component]) {
            case StatusNotifyState.EXECUTING:
                this.componentStatusNotifyState[component] = StatusNotifyState.PENDING;
                break;
            case StatusNotifyState.PENDING:
                break;
            case StatusNotifyState.UNSET:
                do {
                    try {
                        this.componentStatusNotifyState[component] = StatusNotifyState.EXECUTING;
                        await this.doNotifyComponentStatus(component);
                    } catch (error) {
                        logError(LogCategory.GENERAL, tr("Failed to notify the connection status: %o"), error);
                    }
                } /* @ts-ignore */ while(this.componentStatusNotifyState[component] === StatusNotifyState.PENDING);
                this.componentStatusNotifyState[component] = StatusNotifyState.UNSET;
                break;
        }
    }

    private async doNotifyComponentStatus(component: ConnectionComponent) {
        this.events.fire_react("notify_component_status", { component: component, status: await this.getComponentStatus(component, true) });
    }

    async notifyConnectionStatus() {
        switch (this.connectionStatusNotifyState) {
            case StatusNotifyState.EXECUTING:
                this.connectionStatusNotifyState = StatusNotifyState.PENDING;
                break;
            case StatusNotifyState.PENDING:
                break;

            case StatusNotifyState.UNSET:
                do {
                    try {
                        /* This is a workaround since typescript does not know that while awaiting the connectionStatusNotifyState might change */
                        const kFalse = false;
                        if(kFalse) { this.connectionStatusNotifyState = StatusNotifyState.PENDING; }

                        this.connectionStatusNotifyState = StatusNotifyState.EXECUTING;
                        await this.doNotifyConnectionStatus();
                    } catch (error) {
                        logError(LogCategory.GENERAL, tr("Failed to notify the connection status: %o"), error);
                    }
                } while(this.connectionStatusNotifyState === StatusNotifyState.PENDING);
                this.connectionStatusNotifyState = StatusNotifyState.UNSET;
                break;
        }
    }

    private async doNotifyConnectionStatus() {
        let status: ConnectionStatus = { type: "healthy" };

        for(const component of ["signaling", "voice", "video"] as ConnectionComponent[]) {
            let componentState = await this.getComponentStatus(component, false);
            if(componentState.type === "healthy" || componentState.type === "unsupported") {
                continue;
            } else if(componentState.type === "disconnected" && component !== "signaling") {
                switch (component) {
                    case "voice":
                        componentState = { type: "unhealthy", reason: tr("No voice connection"), retryTimestamp: 0 };
                        break;

                    case "video":
                        componentState = { type: "unhealthy", reason: tr("No video connection"), retryTimestamp: 0 };
                        break;
                }
            }

            status = componentState;
            break;
        }

        this.events.fire_react("notify_connection_status", { status: status });
    }
}
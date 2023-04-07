export const createCoopWatchers = coop => {
  return new CoopWatchers(coop);
};

const CoopWatchers = class {
  constructor(coop) {
    this.coop = coop;
    this.controllers = new Set();
    this.eventSources = new Map();
    this.linkEventHandler = ev => {
      const eventData = this.coop.links.parseEvent(ev);
      for (const controller of this.controllers) {
        try {
          controller.enqueue(eventData);
        } catch (error) {
          this.controllers.delete(controller);
        }
      }
    };
    this.followingsEventHandler = ev => {
      const eventData = this.coop.followings.parseEvent(ev);
      for (const controller of this.controllers) {
        try {
          controller.enqueue(eventData);
        } catch (error) {
          this.controllers.delete(controller);
        }
      }
    };
    // TBD: other events
    this.keyAddedEventHandler = ev => {
      const eventData = this.coop.keys.parseEvent(ev);
      for (const controller of this.controllers) {
        try {
          controller.enqueue(eventData);
        } catch (error) {
          this.controllers.delete(controller);
        }
      }
    };
  }
  async watchEventSource(coopUri, es) {
    es.addEventListener("link-added", this.linkEventHandler);
    es.addEventListener("link-removed", this.linkEventHandler);
    es.addEventListener("coop-detected", this.followingsEventHandler);
    es.addEventListener("key-added", this.keyAddedEventHandler);
    this.eventSources.set(coopUri, es);
  }
  closeEventSource(coopUri) {
    this.eventSources.get(coopUri)?.close();
  }
  watch(query) {
    let queryController;
    return new ReadableStream({
      start: controller => {
        queryController = new QueryController(controller, query);
        this.controllers.add(queryController);
      },
      cancel: reason => {
        this.controllers.delete(queryController);
        queryController = null;
      },
    });
  }
  close() {
    for (const es of this.eventSources.values()) es.close();
    for (const ctr of this.controllers) ctr.close();
    this.eventSources = new Set();
    this.controllers = new Set();
  }
};

const QueryController = class {
  constructor(controller, query) {
    this.controller = controller;
    this.query = query;
  }
  enqueue(eventData) {
    if (this.query(eventData)) this.controller.enqueue(eventData);
  }
  close() {
    this.controller.close();
    this.query = null;
    this.controller = null;
  }
};

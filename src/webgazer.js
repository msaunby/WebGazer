(function(window, undefined) {
    console.log('initializing webgazer')
    //strict mode for type safety
    "use strict"

    //auto invoke function to bind our own copy of window and undefined
    
    //set up namespaces for modules
    window.webgazer = window.webgazer || {};
    webgazer.tracker = webgazer.tracker || {};
    webgazer.reg = webgazer.reg || {};
    webgazer.params = webgazer.params || {};

    //PRIVATE VARIABLES
    
    //video elements
    webgazer.params.videoScale = 1;
    var videoElement = null;
    var videoElementCanvas = null;
    webgazer.params.videoElementId = 'webwebgazerVideoFeed'; 
    webgazer.params.videoElementCanvasId = 'webwebgazerVideoCanvas';
    webgazer.params.imgWidth = 1280;
    webgazer.params.imgHeight = 720;

    //DEBUG variables
    //debug control boolean
    var showGazeDot = false;
    //debug element (starts offscreen)
    var gazeDot = document.createElement('div');
    gazeDot.style.position = 'absolute';
    gazeDot.style.left = '20px'; //'-999em';
    gazeDot.style.width = '10px';
    gazeDot.style.height = '10px';
    gazeDot.style.background = 'red';
    gazeDot.style.display = 'none';

    var debugVideoLoc = '';
        
    // loop parameters
    var clockStart = performance.now();
    webgazer.params.dataTimestep = 50; //TODO either make this a settable parameter or otherwise determine best value, currently a settable parameter
    var paused = false;
    //registered callback for loop
    var nopCallback = function(data, time) {};
    var callback = nopCallback;

    //Types that regression systems should handle
    //Describes the source of data so that regression systems may ignore or handle differently the various generating events
    var eventTypes = ['click', 'move'];
    

    //movelistener timeout clock parameters
    var moveClock = performance.now();
    webgazer.params.moveTickSize = 50; //milliseconds

    //currently used tracker and regression models, defaults to clmtrackr and linear regression
    var tracker = new webgazer.tracker.ClmGaze();
    var regs = [new webgazer.reg.RidgeReg()];
    var blinkDetector = new webgazer.BlinkDetector();

    //lookup tables
    var trackerMap = {
        'clmtrackr': function() { return new webgazer.tracker.ClmGaze(); },
        'trackingjs': function() { return new webgazer.tracker.TrackingjsGaze(); },
        'js_objectdetect': function() { return new webgazer.tracker.Js_objectdetectGaze(); }
    };
    var regressionMap = {
        'interaction': function() { return new webgazer.reg.RidgeReg(); },
        'weightedRidge': function() { return new webgazer.reg.RidgeWeightedReg(); }
    };

    //localstorage name
    var localstorageLabel = 'webwebgazerGlobalData';
    //settings object for future storage of settings
    var settings = {};
    var data = [];
    var defaults = {
        'data': [],
        'settings': {},
    };

    //PRIVATE FUNCTIONS

    /**
     * gets the pupil features by following the pipeline which threads an eyes object through each call:
     * tracker gets eye patches -> blink detector -> pupil detection 
     * @param {Canvas} canvas - a canvas which will have the video drawn onto it
     * @param {number} width - the width of canvas
     * @param {number} height - the height of canvas
     */
    function getPupilFeatures(canvas, width, height) {
        if (!canvas) {
            return;
        }
        paintCurrentFrame(canvas, width, height);
        try {
            return blinkDetector.detectBlink(tracker.getEyePatches(canvas, width, height));
        } catch(err) {
            console.log(err);
            return null;
        }
    }

    /**
     * gets the most current frame of video and paints it to a resized version of the canvas with width and height
     * @param {canvas} - the canvas to paint the video on to
     * @param {integer} width - the new width of the canvas
     * @param {integer} height - the new height of the canvas
     */
    function paintCurrentFrame(canvas, width, height) {
        //imgWidth = videoElement.videoWidth * videoScale;
        //imgHeight = videoElement.videoHeight * videoScale;
        if (canvas.width != width) { 
            canvas.width = width;
        }
        if (canvas.height != height) {
            canvas.height = height;
        }

        var ctx = canvas.getContext('2d');
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    }

    /**
     *  paints the video to a canvas and runs the prediction pipeline to get a prediction
     */
    function getPrediction() {
        var predictions = [];
        var features = getPupilFeatures(videoElementCanvas, webgazer.params.imgWidth, webgazer.params.imgHeight);
        if (regs.length == 0) {
            console.log('regression not set, call setRegression()');
            return null;
        }
        for (var reg in regs) {
            predictions.push(regs[reg].predict(features));
        }
        //TODO make better api for this
        return predictions[0] == null ? null : {
            'x' : predictions[0].x,
            'y' : predictions[0].y,
            'all' : predictions
        };
    }

    /**
     * runs every available animation frame if webgazer is not paused
     */
    var smoothingVals = new webgazer.util.DataWindow(4);
    function loop() {
        var gazeData = getPrediction();
        var elapsedTime = performance.now() - clockStart;

        callback(gazeData, elapsedTime);

        if (gazeData && showGazeDot) {
            smoothingVals.push(gazeData);
            var x = 0;
            var y = 0;
            var len = smoothingVals.length;
            for (var d in smoothingVals.data) {
                x += smoothingVals.get(d).x;
                y += smoothingVals.get(d).y;
            }
            var pred = webgazer.util.bound({'x':x/len, 'y':y/len});
            gazeDot.style.top = pred.y + 'px';
            gazeDot.style.left = pred.x + 'px';
        }

        if (!paused) {
            //setTimeout(loop, webgazer.params.dataTimestep);
            requestAnimationFrame(loop);
        }
    }

    /**
     * records click data and passes it to the regression model
     */
    var clickListener = function(event) {
        if (paused) {
            return;
        }
        var features = getPupilFeatures(videoElementCanvas, webgazer.params.imgWidth, webgazer.params.imgHeight);
        if (regs.length == 0) {
            console.log('regression not set, call setRegression()');
            return null;
        }
        for (var reg in regs) {
            regs[reg].addData(features, [event.clientX, event.clientY], eventType[0]); // eventType[0] === 'click'
        }
    }

    /**
     * records mouse movement data and passes it to the regression model
     */
    var moveListener = function(event) {
        if (paused) {
            return;
        }

        var now = performance.now();
        if (now < moveClock + webgazer.params.moveTickSize) {
            return;
        } else {
            moveClock = now;
        }
        var features = getPupilFeatures(videoElementCanvas, webgazer.params.imgWidth, webgazer.params.imgHeight);
        if (regs.length == 0) {
            console.log('regression not set, call setRegression()');
            return null;
        }
        for (var reg in regs) {
            regs[reg].addData(features, [event.clientX, event.clientY], eventType[1]); //eventType[1] === 'move'
        }
    }

    /** loads the global data and passes it to the regression model 
     * 
     */
    function loadGlobalData() {
        var storage = JSON.parse(window.localStorage.getItem(localstorageLabel)) || defaults;
        settings = storage.settings;
        data = storage.data;
        for (var reg in regs) {
            regs[reg].setData(storage.data);
        }
    }
   
   /**
    * constructs the global storage object and adds it to localstorage
    */
    function setGlobalData() {
        var storage = {
            'settings': settings,
            'data': regs[0].getData() || data
        };
        window.localStorage.setItem(localstorageLabel, JSON.stringify(storage));
        //TODO data should probably be stored in webwebgazer object instead of each regression model
        //     -> requires duplication of data, but is likely easier on regression model implementors
    }

    /*
     * clears data from model and global storage
     */
    function clearData() {
        window.localStorage.set(localstorageLabel, undefined);
        for (var reg in regs) {
            regs[reg].setData([]);
        }
    }


    /**
     * initializes all needed dom elements and begins the loop
     */
    function init(videoSrc) {
        videoElement = document.createElement('video');
        videoElement.id = webgazer.params.videoElementId; 
        videoElement.autoplay = true;
        console.log(videoElement);
        videoElement.style.display = 'none';

        //turn the stream into a magic URL 
        videoElement.src = videoSrc;  
        //TODO check to see if we actually need to add the element to the dom
        document.body.appendChild(videoElement);

        videoElementCanvas = document.createElement('canvas'); 
        videoElementCanvas.id = webgazer.params.videoElementCanvasId;
        videoElementCanvas.style.display = 'none';
        document.body.appendChild(videoElementCanvas);


        //third argument set to true so that we get event on 'capture' instead of 'bubbling'
        //this prevents a client using event.stopPropagation() preventing our access to the click
        document.addEventListener('click', clickListener, true);
        document.addEventListener('mousemove', moveListener, true);

        document.body.appendChild(gazeDot);

        //BEGIN CALLBACK LOOP
        paused = false;
        loop();
    }

    //PUBLIC FUNCTIONS - CONTROL

    /**
     * starts all state related to webwebgazer -> dataLoop, video collection, click listener
     */
    webgazer.begin = function() {
        loadGlobalData();

        if (debugVideoLoc) {
            init(debugVideoLoc);
            return webgazer;
        }

        //SETUP VIDEO ELEMENTS
        navigator.getUserMedia = navigator.getUserMedia ||
            navigator.webkitGetUserMedia ||
            navigator.mediaDevices.getUserMedia;

        if(navigator.getUserMedia != null){ 
            var options = { 
                video:true, 
            }; 	     
            //request webcam access 
            navigator.getUserMedia(options, 
                    function(stream){
                        console.log('video stream created');
                        init(window.URL.createObjectURL(stream));                    
                    }, 
                    function(e){ 
                        console.log("No stream"); 
                        videoElement = null;
                    });
        }

        return webgazer;
    }

    /*
     * checks if webgazer has finished initializing after calling begin()
     * @return {boolean} if webgazer is ready
     */
    webgazer.isReady = function() {
        if (videoElementCanvas == null) {
            return false;
        }
        paintCurrentFrame(videoElementCanvas);
        return videoElementCanvas.width > 0;
    }

    /*
     * stops collection of data and predictions
     * @return {webgazer} this
     */
    webgazer.pause = function() {
        paused = true;
        return webgazer;
    }

    /*
     * resumes collection of data and predictions if paused
     * @return {webgazer} this
     */
    webgazer.resume = function() {
        if (!paused) {
            return webgazer;
        }
        paused = false;
        loop();
        return webgazer;
    }

    /**
     * stops collection of data and removes dom modifications, must call begin() to reset up
     * @return {webgazer} this
     */
    webgazer.end = function() {
        //loop may run an extra time and fail due to removed elements
        paused = true;
        //remove video element and canvas
        document.body.removeChild(videoElement);
        document.body.removeChild(videoElementCanvas);

        setGlobalData();
        return webgazer;
    }

    //PUBLIC FUNCTIONS - DEBUG

    /**
     * returns if the browser is compatible with webgazer
     * @return {boolean} if browser is compatible
     */
    webgazer.detectCompatibility = function() {
        //TODO detectCompatibility
        return true;
    }

    /**
     * runs an initial calibration page/step
     */
    webgazer.performCalibration = function(desiredAccuracy) {
        //TODO performCalibration
    }

    /**
     * displays the calibration point for debugging
     * @return {webgazer} this
     */
    webgazer.showPredictionPoints = function(bool) {
        showGazeDot = bool;
        gazeDot.style.left = '-999em';
        gazeDot.style.display = bool ? 'block' : 'none';
        return webgazer;
    }

    /**
     *  set a static video file to be used instead of webcam video
     *  @param {string} videoLoc - video file location
     *  @return {webgazer} this
     */
    webgazer.setStaticVideo = function(videoLoc) {
       debugVideoLoc = videoLoc;
       return webgazer;
    }

    //SETTERS
    /**
     * sets the tracking module
     * @param {string} the name of the tracking module to use
     * @return {webgazer} this
     */
    webgazer.setTracker = function(name) {
        if (trackermap[name] == undefined) {
            console.log('Invalid tracker selection');
            console.log('Options are: ');
            for (var tracker in trackerMap) {
                console.log(tracker);
            }
            return webgazer;
        }
        tracker = trackerMap[name]();    
        return webgazer;
    }

    /**
     * sets the regression module and clears any other regression modules
     * @param {string} the name of the regression module to use
     * @return {webgazer} this
     */
    webgazer.setRegression = function(name) {
        if (regressionMap[name] == undefined) {
            console.log('Invalid regression selection');
            console.log('Options are: ');
            for (var reg in regMap) {
                console.log(reg);
            }
            return webgazer;
        }
        data = regs[0].getData();
        regs = [regressionMap[name]()];
        regs[0].setData(data);
        return webgazer;
    }

    /**
     * adds a new regression module to the list of regression modules, seeding its data from the first regression module
     * @param {string} name - the string name of the regression module to add
     * @return {webgazer} this
     */
    webgazer.addRegression = function(name) {
        var newReg = regressionMap[name]();
        data = regs[0].getData();
        newReg.setData(data);
        regs.push(newReg);
        return webgazer;
    }

    /**
     * sets a callback to be executed on every gaze event (currently all time steps)
     * @param {function}
     *      @param {data} - the prediction data
     *      @param {elapsedTime} - the elapsed time since begin() was called
     * @return {webgazer} this
     */
    webgazer.setGazeListener = function(listener) {
        callback = listener;
        return webgazer;
    }

    /**
     * removes the callback set by setGazeListener
     * @return {webgazer} this
     */
    webgazer.clearGazeListener = function() {
        callback = nopCallback;
        return webgazer;
    }

    //GETTERS
    /**
     * returns the tracker currently in use
     * @return {tracker} an object following the tracker interface
     */
    webgazer.getTracker = function() {
        return tracker;
    }
    
    /**
     * returns the regression currently in use
     * @return {regression} an object following the regression interface
     */
    webgazer.getRegression = function() {
        return reg;
    }

    /**
     * requests an immediate prediction
     * @return {object} prediction data object
     */
    webgazer.getCurrentPrediction = function() {
        return getPrediction(); 
    }

    /**
     * returns the different event types that may be passed to regressions when calling regression.addData()
     * @return {array} array of strings where each string is an event type
     */
    webgazer.params.getEventTypes = function() { 
        return eventTypes.slice(); 
    }
}(window));

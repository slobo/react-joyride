import React from 'react';
import PropTypes from 'prop-types';
import treeChanges from 'tree-changes';
import is from 'is-lite';

import Store from '../modules/store';
import {
  getElement,
  getScrollTo,
  getScrollParent,
  hasCustomScrollParent,
  isFixed,
  scrollTo,
} from '../modules/dom';
import { canUseDOM, isEqual, log } from '../modules/helpers';
import { getMergedStep, validateSteps } from '../modules/step';

import { ACTIONS, EVENTS, LIFECYCLE, STATUS } from '../constants';

import Step from './Step';

class Joyride extends React.Component {
  constructor(props) {
    super(props);

    this.state = {};
  }

  static propTypes = {
    beaconComponent: PropTypes.oneOfType([
      PropTypes.func,
      PropTypes.element,
    ]),
    callback: PropTypes.func,
    continuous: PropTypes.bool,
    debug: PropTypes.bool,
    disableCloseOnEsc: PropTypes.bool,
    disableOverlay: PropTypes.bool,
    disableOverlayClose: PropTypes.bool,
    disableScrolling: PropTypes.bool,
    floaterProps: PropTypes.shape({
      offset: PropTypes.number,
    }),
    getHelpers: PropTypes.func,
    hideBackButton: PropTypes.bool,
    locale: PropTypes.object,
    run: PropTypes.bool,
    scrollOffset: PropTypes.number,
    scrollToFirstStep: PropTypes.bool,
    showProgress: PropTypes.bool,
    showSkipButton: PropTypes.bool,
    spotlightClicks: PropTypes.bool,
    spotlightPadding: PropTypes.number,
    stepIndex: PropTypes.number,
    steps: PropTypes.array,
    styles: PropTypes.object,
    tooltipComponent: PropTypes.oneOfType([
      PropTypes.func,
      PropTypes.element,
    ]),
  };

  static defaultProps = {
    continuous: false,
    debug: false,
    disableCloseOnEsc: false,
    disableOverlay: false,
    disableOverlayClose: false,
    disableScrolling: false,
    getHelpers: () => {},
    hideBackButton: false,
    run: true,
    scrollOffset: 20,
    scrollToFirstStep: false,
    showSkipButton: false,
    showProgress: false,
    spotlightClicks: false,
    spotlightPadding: 10,
    steps: [],
  };

  componentDidMount() {
    if (!canUseDOM) return;

    const { disableCloseOnEsc } = this.props;

    this.initStore();

    /* istanbul ignore else */
    if (!disableCloseOnEsc) {
      document.body.addEventListener('keydown', this.handleKeyboard, { passive: true });
    }
  }

  componentWillReceiveProps(nextProps) {
    if (!canUseDOM) return;
    const { action, status } = this.state;
    const { steps, stepIndex } = this.props;
    const { debug, run, steps: nextSteps, stepIndex: nextStepIndex } = nextProps;
    const { setSteps, start, stop, update } = this.store;
    const diffProps = !isEqual(this.props, nextProps);
    const { changed } = treeChanges(this.props, nextProps);

    if (diffProps) {
      log({
        title: 'props',
        data: [
          { key: 'nextProps', value: nextProps },
          { key: 'props', value: this.props },
        ],
        debug,
      });

      const stepsChanged = !isEqual(nextSteps, steps);
      const stepIndexChanged = is.number(nextStepIndex) && changed('stepIndex');

      /* istanbul ignore else */
      if (changed('run')) {
        if (run) {
          start(nextStepIndex);
        }
        else {
          stop();
        }
      }

      if (stepsChanged) {
        if (validateSteps(nextSteps, debug)) {
          setSteps(nextSteps);
        }
        else {
          console.warn('Steps are not valid', nextSteps); //eslint-disable-line no-console
        }
      }

      /* istanbul ignore else */
      if (stepIndexChanged) {
        let nextAction = stepIndex < nextStepIndex ? ACTIONS.NEXT : ACTIONS.PREV;

        if (action === ACTIONS.STOP) {
          nextAction = ACTIONS.START;
        }

        if (![STATUS.FINISHED, STATUS.SKIPPED].includes(status)) {
          update({
            action: action === ACTIONS.CLOSE ? ACTIONS.CLOSE : nextAction,
            index: nextStepIndex,
            lifecycle: LIFECYCLE.INIT,
          });
        }
      }
    }
  }

  componentDidUpdate(prevProps, prevState) {
    if (!canUseDOM) return;

    const { index, lifecycle, status } = this.state;
    const { debug, steps } = this.props;
    const { reset } = this.store;
    const { changed, changedFrom, changedTo } = treeChanges(prevState, this.state);
    const diffState = !isEqual(prevState, this.state);
    const step = getMergedStep(steps[index], this.props);

    if (diffState) {
      log({
        title: 'state',
        data: [
          { key: 'state', value: this.state },
          { key: 'changed', value: diffState },
          { key: 'step', value: step },
        ],
        debug,
      });

      const callbackData = {
        ...this.state,
        index,
        step,
      };

      if (changedTo('status', [STATUS.FINISHED, STATUS.SKIPPED])) {
        const prevStep = getMergedStep(steps[prevState.index], this.props);

        this.callback({
          ...callbackData,
          index: prevState.index,
          lifecycle: LIFECYCLE.COMPLETE,
          step: prevStep,
          type: EVENTS.STEP_AFTER,
        });
        this.callback({
          ...callbackData,
          type: EVENTS.TOUR_END,
          // Return the last step when the tour is finished
          step: prevStep,
          index: prevState.index,
        });
        reset();
      }
      else if (changedFrom('status', STATUS.READY, STATUS.RUNNING)) {
        this.callback({
          ...callbackData,
          type: EVENTS.TOUR_START,
        });
      }
      else if (changed('status')) {
        this.callback({
          ...callbackData,
          type: EVENTS.TOUR_STATUS,
        });
      }
      else if (changedTo('action', ACTIONS.RESET)) {
        this.callback({
          ...callbackData,
          type: EVENTS.TOUR_STATUS,
        });
      }

      if (step) {
        this.scrollToStep(prevState);

        if (step.placement === 'center' && status === STATUS.RUNNING && lifecycle === LIFECYCLE.INIT) {
          this.store.update({ lifecycle: LIFECYCLE.READY });
        }
      }
    }
  }

  componentWillUnmount() {
    const { disableCloseOnEsc } = this.props;

    /* istanbul ignore else */
    if (!disableCloseOnEsc) {
      document.body.removeEventListener('keydown', this.handleKeyboard);
    }
  }

  initStore = () => {
    const { debug, getHelpers, run, stepIndex, steps } = this.props;

    this.store = new Store({
      ...this.props,
      controlled: run && is.number(stepIndex),
    });
    this.helpers = this.store.getHelpers();

    const { addListener } = this.store;
    const { start, stop, ...publicHelpers } = this.helpers;

    this.setState({ ...this.store.getState() }, () => {
      log({
        title: 'init',
        data: [
          { key: 'props', value: this.props },
          { key: 'state', value: this.state },
        ],
        debug,
      });

      // Sync the store to this component's state.
      addListener(this.syncState);

      if (validateSteps(steps, debug) && run) {
        start();
      }

      getHelpers(publicHelpers);
    });
  };

  scrollToStep(prevState) {
    const { index, lifecycle, status } = this.state;
    const { debug, disableScrolling, scrollToFirstStep, scrollOffset, steps } = this.props;
    const step = getMergedStep(steps[index], this.props);

    if (step) {
      const target = getElement(step.target);
      const shouldScroll = step
        && !disableScrolling
        && step.placement !== 'center'
        && (!step.isFixed || !isFixed(target)) // fixed steps don't need to scroll
        && (prevState.lifecycle !== lifecycle && [LIFECYCLE.BEACON, LIFECYCLE.TOOLTIP].includes(lifecycle))
        && (scrollToFirstStep || prevState.index !== index);

      if (status === STATUS.RUNNING && shouldScroll) {
        const hasCustomScroll = hasCustomScrollParent(target);
        const scrollParent = getScrollParent(target);
        let scrollY = Math.floor(getScrollTo(target, scrollOffset)) || 0;

        log({
          title: 'scrollToStep',
          data: [
            { key: 'index', value: index },
            { key: 'lifecycle', value: lifecycle },
            { key: 'status', value: status },
          ],
          debug,
        });

        if (lifecycle === LIFECYCLE.BEACON && this.beaconPopper) {
          const { placement, popper } = this.beaconPopper;

          if (!['bottom'].includes(placement) && !hasCustomScroll) {
            scrollY = Math.floor(popper.top - scrollOffset);
          }
        }
        else if (lifecycle === LIFECYCLE.TOOLTIP && this.tooltipPopper) {
          const { flipped, placement, popper } = this.tooltipPopper;

          if (['top', 'right', 'left'].includes(placement) && !flipped && !hasCustomScroll) {
            scrollY = Math.floor(popper.top - scrollOffset);
          }
          else {
            scrollY -= step.spotlightPadding;
          }
        }

        scrollY = scrollY >= 0 ? scrollY : 0;

        if (status === STATUS.RUNNING && shouldScroll) {
          scrollTo(scrollY, scrollParent);
        }
      }
    }
  }

  /**
   * Trigger the callback.
   *
   * @private
   * @param {Object} data
   */
  callback = (data) => {
    const { callback } = this.props;

    /* istanbul ignore else */
    if (is.function(callback)) {
      callback(data);
    }
  };

  /**
   * Keydown event listener
   *
   * @private
   * @param {Event} e - Keyboard event
   */
  handleKeyboard = (e) => {
    const { index, lifecycle } = this.state;
    const { steps } = this.props;
    const step = steps[index];
    const intKey = window.Event ? e.which : e.keyCode;

    if (lifecycle === LIFECYCLE.TOOLTIP) {
      if (intKey === 27 && (step && !step.disableCloseOnEsc)) {
        this.store.close();
      }
    }
  };

  /**
   * Sync the store with the component's state
   *
   * @param {Object} state
   */
  syncState = (state) => {
    this.setState(state);
  };

  getPopper = (popper, type) => {
    if (type === 'wrapper') {
      this.beaconPopper = popper;
    }
    else {
      this.tooltipPopper = popper;
    }
  };

  render() {
    if (!canUseDOM) return null;

    const { index, status } = this.state;
    const { continuous, debug, disableScrolling, steps } = this.props;
    const step = getMergedStep(steps[index], this.props);
    let output;

    if (status === STATUS.RUNNING && step) {
      output = (
        <Step
          {...this.state}
          callback={this.callback}
          continuous={continuous}
          debug={debug}
          disableScrolling={disableScrolling}
          getPopper={this.getPopper}
          helpers={this.helpers}
          step={step}
          update={this.store.update}
        />
      );
    }

    return (
      <div className="joyride">
        {output}
      </div>
    );
  }
}

export default Joyride;

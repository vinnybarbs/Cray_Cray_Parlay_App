import { useEffect, useState } from 'react';
import './ProgressSteps.css';

const ProgressSteps = ({ progress }) => {
  const steps = [
    { 
      key: 'odds', 
      label: 'Gathering Odds', 
      sublabel: 'Fetching live odds data...' 
    },
    { 
      key: 'research', 
      label: 'Doing Research', 
      sublabel: 'Analyzing team stats...' 
    },
    { 
      key: 'analysis', 
      label: 'Selecting Picks', 
      sublabel: 'Building your parlay...' 
    }
  ];

  const getStepStatus = (stepKey) => {
    return progress[stepKey] || 'pending';
  };

  const renderIcon = (status) => {
    if (status === 'complete') {
      return <div className="step-icon complete">✓</div>;
    } else if (status === 'active') {
      return <div className="step-icon active spinner"></div>;
    } else {
      return <div className="step-icon pending"></div>;
    }
  };

  return (
    <div className="progress-steps">
      {steps.map((step, index) => {
        const status = getStepStatus(step.key);
        return (
          <div key={step.key} className={`progress-step ${status}`}>
            {renderIcon(status)}
            <div className="step-content">
              <div className="step-label">{step.label}</div>
              {status === 'active' && (
                <div className="step-sublabel">{step.sublabel}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ProgressSteps;

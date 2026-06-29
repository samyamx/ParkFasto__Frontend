import React from 'react';
import logo from '../../assets/logo.png';

const AppLogo = ({ size = 32, className = '', alt = 'Parko' }) => (
  <img
    src={logo}
    alt={alt}
    className={className}
    width={size}
    height={size}
    style={{ objectFit: 'contain' }}
  />
);

export default AppLogo;

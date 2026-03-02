import React, { forwardRef } from 'react';
import clsx from 'clsx';
import { TextVariant, TextWeight, TextColor, TEXT_VARIANTS, TEXT_WEIGHTS, TEXT_COLORS } from '../../types/typography';

export interface TextProps extends React.HTMLAttributes<HTMLElement> {
  variant: TextVariant;
  weight?: TextWeight;
  color?: TextColor;
  as?: React.ElementType;
  children: React.ReactNode;
}

export const Text = forwardRef<HTMLElement, TextProps>(
  ({ variant, weight, color, as, className, children, ...props }, ref) => {
    const config = TEXT_VARIANTS[variant];
    const Component = as || config.defaultElement;

    return (
      <Component
        ref={ref}
        className={clsx(
          config.size,
          TEXT_WEIGHTS[weight || config.defaultWeight],
          TEXT_COLORS[color || config.defaultColor],
          config.extraClasses,
          className,
        )}
        {...props}
      >
        {children}
      </Component>
    );
  },
);

Text.displayName = 'Text';

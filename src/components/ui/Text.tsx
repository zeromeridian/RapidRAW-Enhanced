import React, { forwardRef } from 'react';
import clsx from 'clsx';
import { TextWeight, TextColor, VariantConfig, TextWeights, TextColors } from '../../types/typography';

export interface TextProps extends React.HTMLAttributes<HTMLElement> {
  variant: VariantConfig;
  weight?: TextWeight;
  color?: TextColor;
  as?: React.ElementType;
  children: React.ReactNode;
}

export const Text = forwardRef<HTMLElement, TextProps>(
  ({ variant, weight, color, as, className, children, ...props }, ref) => {
    const Component = as || variant.defaultElement;

    return (
      <Component
        ref={ref}
        className={clsx(
          variant.size,
          TextWeights[weight || variant.defaultWeight],
          TextColors[color || variant.defaultColor],
          variant.extraClasses,
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
export default Text;

#!/usr/bin/env python3
"""
Python Environment Setup Script for C-Simple

This script checks and installs required packages for the C-Simple application.
It will be called automatically when the application needs Python dependencies.

Usage:
  python setup_environment.py
"""

import sys
import os
import argparse
import subprocess
import platform


def parse_arguments():
    parser = argparse.ArgumentParser(description="Setup Python environment for C-Simple")
    parser.add_argument('--check-only', action='store_true', help='Only check if packages are installed')
    return parser.parse_args()


def check_package(package_name):
    """Check if a package is installed."""
    try:
        __import__(package_name)
        return True
    except ImportError:
        return False


def install_package(package_name):
    """Install a package using pip."""
    try:
        print(f"Installing {package_name}...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", package_name])
        return True
    except subprocess.CalledProcessError as e:
        print(f"Failed to install {package_name}: {e}", file=sys.stderr)
        return False


def check_gpu_support():
    """Check if the system has CUDA support for PyTorch."""
    try:
        # Try to detect NVIDIA GPU
        if platform.system() == "Windows":
            # Check if nvidia-smi exists
            try:
                subprocess.check_output(["where", "nvidia-smi"])
                return True
            except subprocess.CalledProcessError:
                return False
        elif platform.system() == "Linux" or platform.system() == "Darwin":
            # Check if nvidia-smi exists
            try:
                subprocess.check_output(["which", "nvidia-smi"])
                return True
            except subprocess.CalledProcessError:
                return False
        return False
    except Exception:
        return False


def main():
    args = parse_arguments()
    
    # Required packages
    packages = {
        'transformers': 'transformers',
        'torch': 'torch',
        'accelerate': 'accelerate',
    }
    
    # Check which packages are missing
    missing_packages = {name: pkg for name, pkg in packages.items() if not check_package(name)}
    
    if not missing_packages:
        print("All required packages are installed.")
        return 0
    
    if args.check_only:
        print(f"Missing packages: {', '.join(missing_packages.keys())}")
        return 1
    
    # Install missing packages
    print(f"Installing {len(missing_packages)} missing packages...")
    
    # Special handling for torch - check for GPU support
    if 'torch' in missing_packages:
        if check_gpu_support():
            print("NVIDIA GPU detected, installing PyTorch with CUDA support")
            # Install PyTorch with CUDA
            try:
                if platform.system() == "Windows":
                    # Use the correct CUDA version - you might need to adjust this
                    torch_command = "torch==2.0.1+cu118 --extra-index-url https://download.pytorch.org/whl/cu118"
                else:
                    torch_command = "torch==2.0.1"
                
                subprocess.check_call([sys.executable, "-m", "pip", "install", torch_command])
                del missing_packages['torch']  # Remove from list since we installed it
            except subprocess.CalledProcessError as e:
                print(f"Failed to install PyTorch with CUDA: {e}", file=sys.stderr)
                print("Falling back to CPU version")
    
    # Install remaining packages
    success = True
    for name, pkg in missing_packages.items():
        if not install_package(pkg):
            success = False
    
    if success:
        print("All packages installed successfully.")
        return 0
    else:
        print("Failed to install some packages. Please install them manually.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
